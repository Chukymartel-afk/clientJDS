const express = require('express');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// Database Setup
// =====================================================

const DB_PATH = path.join(__dirname, 'ouverture.db');
let db;

async function initDatabase() {
    const SQL = await initSqlJs();

    // Load existing database or create new one
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    // Create tables
    db.run(`
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            nom TEXT NOT NULL,
            email TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS demandes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_name TEXT NOT NULL,
            owner_name TEXT NOT NULL,
            contact_name TEXT,
            address TEXT NOT NULL,
            city TEXT NOT NULL,
            postal_code TEXT NOT NULL,
            sector TEXT NOT NULL,
            annual_purchase TEXT NOT NULL,
            promo_accepted TEXT,
            promo_min_order TEXT,
            email_responsable TEXT NOT NULL,
            email_facturation TEXT NOT NULL,
            phone TEXT NOT NULL,
            signature TEXT NOT NULL,
            status TEXT DEFAULT 'nouvelle',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Analytics tables
    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT UNIQUE NOT NULL,
            device_type TEXT,
            browser TEXT,
            os TEXT,
            screen_width INTEGER,
            screen_height INTEGER,
            referrer TEXT,
            utm_source TEXT,
            utm_medium TEXT,
            utm_campaign TEXT,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            ended_at DATETIME,
            completed INTEGER DEFAULT 0
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            event_data TEXT,
            step TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS step_times (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            step TEXT NOT NULL,
            time_spent INTEGER,
            entered_at DATETIME,
            left_at DATETIME
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS field_interactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            field_name TEXT NOT NULL,
            interaction_type TEXT,
            time_spent INTEGER,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Create default admin if none exists
    const adminCount = db.exec("SELECT COUNT(*) as count FROM admins")[0];
    if (!adminCount || adminCount.values[0][0] === 0) {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        db.run(
            'INSERT INTO admins (username, password, nom, email) VALUES (?, ?, ?, ?)',
            ['admin', hashedPassword, 'Administrateur', 'admin@lesjardinsdusaguenay.com']
        );
        console.log('Admin par défaut créé: admin / admin123');
    }

    saveDatabase();
}

function saveDatabase() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
}

// Helper function to get results as objects
function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    if (params.length > 0) {
        stmt.bind(params);
    }
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

function queryOne(sql, params = []) {
    const results = queryAll(sql, params);
    return results.length > 0 ? results[0] : null;
}

function runQuery(sql, params = []) {
    db.run(sql, params);
    saveDatabase();
    return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0].values[0][0] };
}

// =====================================================
// Middleware
// =====================================================

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.use(session({
    secret: 'jardins-saguenay-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true with HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Auth middleware
function requireAuth(req, res, next) {
    if (req.session.adminId) {
        next();
    } else {
        res.status(401).json({ error: 'Non autorisé' });
    }
}

// =====================================================
// API Routes - Analytics (public - for tracking)
// =====================================================

// Start a new session
app.post('/api/analytics/session', (req, res) => {
    try {
        const {
            sessionId,
            deviceType,
            browser,
            os,
            screenWidth,
            screenHeight,
            referrer,
            utmSource,
            utmMedium,
            utmCampaign
        } = req.body;

        const now = new Date().toISOString();
        runQuery(`
            INSERT OR REPLACE INTO sessions (
                session_id, device_type, browser, os, screen_width, screen_height,
                referrer, utm_source, utm_medium, utm_campaign, started_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            sessionId, deviceType, browser, os, screenWidth, screenHeight,
            referrer, utmSource, utmMedium, utmCampaign, now
        ]);

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics session error:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// Track an event
app.post('/api/analytics/event', (req, res) => {
    try {
        const { sessionId, eventType, eventData, step } = req.body;
        const now = new Date().toISOString();

        runQuery(`
            INSERT INTO events (session_id, event_type, event_data, step, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `, [sessionId, eventType, JSON.stringify(eventData || {}), step, now]);

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics event error:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// Track step timing
app.post('/api/analytics/step-time', (req, res) => {
    try {
        const { sessionId, step, timeSpent, enteredAt, leftAt } = req.body;

        runQuery(`
            INSERT INTO step_times (session_id, step, time_spent, entered_at, left_at)
            VALUES (?, ?, ?, ?, ?)
        `, [sessionId, step, timeSpent, enteredAt, leftAt]);

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics step-time error:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// Track field interaction
app.post('/api/analytics/field', (req, res) => {
    try {
        const { sessionId, fieldName, interactionType, timeSpent } = req.body;
        const now = new Date().toISOString();

        runQuery(`
            INSERT INTO field_interactions (session_id, field_name, interaction_type, time_spent, timestamp)
            VALUES (?, ?, ?, ?, ?)
        `, [sessionId, fieldName, interactionType, timeSpent, now]);

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics field error:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// End session
app.post('/api/analytics/session/end', (req, res) => {
    try {
        const { sessionId, completed } = req.body;
        const now = new Date().toISOString();

        runQuery(`
            UPDATE sessions SET ended_at = ?, completed = ? WHERE session_id = ?
        `, [now, completed ? 1 : 0, sessionId]);

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics session end error:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// =====================================================
// API Routes - Analytics Stats (admin only)
// =====================================================

app.get('/api/analytics/overview', requireAuth, (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString();

        // Total sessions
        const totalSessions = queryOne(
            'SELECT COUNT(*) as count FROM sessions WHERE started_at >= ?',
            [startDateStr]
        ).count;

        // Completed sessions
        const completedSessions = queryOne(
            'SELECT COUNT(*) as count FROM sessions WHERE started_at >= ? AND completed = 1',
            [startDateStr]
        ).count;

        // Conversion rate
        const conversionRate = totalSessions > 0 ? ((completedSessions / totalSessions) * 100).toFixed(1) : 0;

        // Average time on form (for completed sessions)
        const avgTimeResult = queryOne(`
            SELECT AVG(
                CAST((julianday(ended_at) - julianday(started_at)) * 86400 AS INTEGER)
            ) as avg_time
            FROM sessions
            WHERE started_at >= ? AND completed = 1 AND ended_at IS NOT NULL
        `, [startDateStr]);
        const avgTimeOnForm = avgTimeResult.avg_time ? Math.round(avgTimeResult.avg_time) : 0;

        // Device breakdown
        const devices = queryAll(`
            SELECT device_type, COUNT(*) as count
            FROM sessions
            WHERE started_at >= ?
            GROUP BY device_type
        `, [startDateStr]);

        // Sessions by day
        const sessionsByDay = queryAll(`
            SELECT DATE(started_at) as date,
                   COUNT(*) as total,
                   SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed
            FROM sessions
            WHERE started_at >= ?
            GROUP BY DATE(started_at)
            ORDER BY date ASC
        `, [startDateStr]);

        // Sessions by hour
        const sessionsByHour = queryAll(`
            SELECT CAST(strftime('%H', started_at) AS INTEGER) as hour, COUNT(*) as count
            FROM sessions
            WHERE started_at >= ?
            GROUP BY hour
            ORDER BY hour ASC
        `, [startDateStr]);

        res.json({
            totalSessions,
            completedSessions,
            conversionRate: parseFloat(conversionRate),
            avgTimeOnForm,
            devices,
            sessionsByDay,
            sessionsByHour
        });
    } catch (error) {
        console.error('Analytics overview error:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/analytics/funnel', requireAuth, (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString();

        // Get step completion counts
        const steps = ['1', '2', '3', 'success'];
        const funnel = [];

        for (const step of steps) {
            const count = queryOne(`
                SELECT COUNT(DISTINCT session_id) as count
                FROM step_times
                WHERE step = ? AND session_id IN (
                    SELECT session_id FROM sessions WHERE started_at >= ?
                )
            `, [step, startDateStr]).count;
            funnel.push({ step, count });
        }

        // Average time per step
        const stepTimes = queryAll(`
            SELECT step, AVG(time_spent) as avg_time
            FROM step_times
            WHERE session_id IN (
                SELECT session_id FROM sessions WHERE started_at >= ?
            )
            GROUP BY step
        `, [startDateStr]);

        res.json({ funnel, stepTimes });
    } catch (error) {
        console.error('Analytics funnel error:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/analytics/promo', requireAuth, (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString();

        // Promo card interactions
        const promoShown = queryOne(`
            SELECT COUNT(*) as count FROM events
            WHERE event_type = 'promo_shown' AND timestamp >= ?
        `, [startDateStr]).count;

        const promoAccepted = queryOne(`
            SELECT COUNT(*) as count FROM events
            WHERE event_type = 'promo_accepted' AND timestamp >= ?
        `, [startDateStr]).count;

        const promoRefused = queryOne(`
            SELECT COUNT(*) as count FROM events
            WHERE event_type = 'promo_refused' AND timestamp >= ?
        `, [startDateStr]).count;

        // Time viewing promo card before decision
        const avgPromoViewTime = queryOne(`
            SELECT AVG(CAST(json_extract(event_data, '$.viewTime') AS INTEGER)) as avg_time
            FROM events
            WHERE event_type IN ('promo_accepted', 'promo_refused') AND timestamp >= ?
        `, [startDateStr]).avg_time || 0;

        res.json({
            promoShown,
            promoAccepted,
            promoRefused,
            avgPromoViewTime: Math.round(avgPromoViewTime),
            acceptanceRate: promoShown > 0 ? ((promoAccepted / promoShown) * 100).toFixed(1) : 0
        });
    } catch (error) {
        console.error('Analytics promo error:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/analytics/abandons', requireAuth, (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString();

        // Abandons by step
        const abandonsByStep = queryAll(`
            SELECT st.step, COUNT(DISTINCT st.session_id) as count
            FROM step_times st
            JOIN sessions s ON st.session_id = s.session_id
            WHERE s.started_at >= ? AND s.completed = 0
            AND st.step = (
                SELECT step FROM step_times
                WHERE session_id = st.session_id
                ORDER BY left_at DESC LIMIT 1
            )
            GROUP BY st.step
        `, [startDateStr]);

        // Fields with most focus time before abandon
        const fieldAbandonData = queryAll(`
            SELECT fi.field_name,
                   COUNT(*) as abandon_count,
                   AVG(fi.time_spent) as avg_time
            FROM field_interactions fi
            JOIN sessions s ON fi.session_id = s.session_id
            WHERE s.started_at >= ? AND s.completed = 0
            GROUP BY fi.field_name
            ORDER BY abandon_count DESC
            LIMIT 10
        `, [startDateStr]);

        res.json({ abandonsByStep, fieldAbandonData });
    } catch (error) {
        console.error('Analytics abandons error:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/analytics/sources', requireAuth, (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        const startDateStr = startDate.toISOString();

        // Traffic sources
        const sources = queryAll(`
            SELECT
                COALESCE(utm_source, 'direct') as source,
                COUNT(*) as total,
                SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed
            FROM sessions
            WHERE started_at >= ?
            GROUP BY COALESCE(utm_source, 'direct')
            ORDER BY total DESC
        `, [startDateStr]);

        // Referrers
        const referrers = queryAll(`
            SELECT
                CASE
                    WHEN referrer IS NULL OR referrer = '' THEN 'Direct'
                    ELSE referrer
                END as referrer,
                COUNT(*) as count
            FROM sessions
            WHERE started_at >= ?
            GROUP BY referrer
            ORDER BY count DESC
            LIMIT 10
        `, [startDateStr]);

        res.json({ sources, referrers });
    } catch (error) {
        console.error('Analytics sources error:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/analytics/realtime', requireAuth, (req, res) => {
    try {
        const fiveMinutesAgo = new Date();
        fiveMinutesAgo.setMinutes(fiveMinutesAgo.getMinutes() - 5);
        const fiveMinutesAgoStr = fiveMinutesAgo.toISOString();

        // Active sessions (with activity in last 5 minutes)
        const activeSessions = queryAll(`
            SELECT DISTINCT s.session_id, s.device_type, s.started_at,
                   (SELECT step FROM step_times WHERE session_id = s.session_id ORDER BY entered_at DESC LIMIT 1) as current_step
            FROM sessions s
            JOIN events e ON s.session_id = e.session_id
            WHERE e.timestamp >= ?
            ORDER BY e.timestamp DESC
        `, [fiveMinutesAgoStr]);

        // Recent completions
        const recentCompletions = queryAll(`
            SELECT session_id, ended_at
            FROM sessions
            WHERE completed = 1 AND ended_at >= ?
            ORDER BY ended_at DESC
            LIMIT 10
        `, [fiveMinutesAgoStr]);

        res.json({
            activeCount: activeSessions.length,
            activeSessions,
            recentCompletions
        });
    } catch (error) {
        console.error('Analytics realtime error:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// =====================================================
// API Routes - Demandes
// =====================================================

// Submit new demande (public)
app.post('/api/demandes', (req, res) => {
    try {
        const {
            companyName,
            ownerName,
            contactName,
            address,
            city,
            postalCode,
            sector,
            annualPurchase,
            promoAccepted,
            promoMinOrder,
            emailResponsable,
            emailFacturation,
            phone,
            signature
        } = req.body;

        const now = new Date().toISOString();
        const result = runQuery(`
            INSERT INTO demandes (
                company_name, owner_name, contact_name, address, city, postal_code,
                sector, annual_purchase, promo_accepted, promo_min_order,
                email_responsable, email_facturation, phone, signature, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            companyName,
            ownerName,
            contactName || ownerName,
            address,
            city,
            postalCode,
            sector,
            annualPurchase,
            promoAccepted || 'no',
            promoMinOrder || '',
            emailResponsable,
            emailFacturation,
            phone,
            signature,
            now,
            now
        ]);

        res.json({
            success: true,
            message: 'Demande soumise avec succès',
            id: result.lastInsertRowid
        });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur lors de la soumission' });
    }
});

// Get all demandes (admin only)
app.get('/api/demandes', requireAuth, (req, res) => {
    try {
        const demandes = queryAll('SELECT * FROM demandes ORDER BY created_at DESC');
        res.json(demandes);
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Get single demande (admin only)
app.get('/api/demandes/:id', requireAuth, (req, res) => {
    try {
        const demande = queryOne('SELECT * FROM demandes WHERE id = ?', [parseInt(req.params.id)]);
        if (demande) {
            res.json(demande);
        } else {
            res.status(404).json({ error: 'Demande non trouvée' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Update demande status (admin only)
app.patch('/api/demandes/:id', requireAuth, (req, res) => {
    try {
        const { status, notes } = req.body;
        const now = new Date().toISOString();
        runQuery(
            'UPDATE demandes SET status = ?, notes = ?, updated_at = ? WHERE id = ?',
            [status, notes, now, parseInt(req.params.id)]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Delete demande (admin only)
app.delete('/api/demandes/:id', requireAuth, (req, res) => {
    try {
        runQuery('DELETE FROM demandes WHERE id = ?', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// =====================================================
// API Routes - Auth
// =====================================================

// Login
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        const admin = queryOne('SELECT * FROM admins WHERE username = ?', [username]);

        if (admin && bcrypt.compareSync(password, admin.password)) {
            req.session.adminId = admin.id;
            req.session.adminName = admin.nom;
            res.json({
                success: true,
                admin: { id: admin.id, nom: admin.nom, username: admin.username }
            });
        } else {
            res.status(401).json({ error: 'Identifiants invalides' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Check auth status
app.get('/api/auth/me', (req, res) => {
    if (req.session.adminId) {
        const admin = queryOne('SELECT id, username, nom, email FROM admins WHERE id = ?', [req.session.adminId]);
        res.json({ authenticated: true, admin });
    } else {
        res.json({ authenticated: false });
    }
});

// =====================================================
// API Routes - Admin Management
// =====================================================

// Get all admins (admin only)
app.get('/api/admins', requireAuth, (req, res) => {
    try {
        const admins = queryAll('SELECT id, username, nom, email, created_at FROM admins');
        res.json(admins);
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Create new admin (admin only)
app.post('/api/admins', requireAuth, (req, res) => {
    try {
        const { username, password, nom, email } = req.body;

        // Check if username exists
        const existing = queryOne('SELECT id FROM admins WHERE username = ?', [username]);
        if (existing) {
            return res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        const result = runQuery(
            'INSERT INTO admins (username, password, nom, email) VALUES (?, ?, ?, ?)',
            [username, hashedPassword, nom, email]
        );

        res.json({ success: true, id: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Delete admin (admin only)
app.delete('/api/admins/:id', requireAuth, (req, res) => {
    try {
        // Prevent deleting yourself
        if (parseInt(req.params.id) === req.session.adminId) {
            return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
        }

        runQuery('DELETE FROM admins WHERE id = ?', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// =====================================================
// API Routes - Stats
// =====================================================

app.get('/api/stats', requireAuth, (req, res) => {
    try {
        const total = queryOne('SELECT COUNT(*) as count FROM demandes').count;
        const nouvelles = queryOne("SELECT COUNT(*) as count FROM demandes WHERE status = 'nouvelle'").count;
        const enCours = queryOne("SELECT COUNT(*) as count FROM demandes WHERE status = 'en_cours'").count;
        const approuvees = queryOne("SELECT COUNT(*) as count FROM demandes WHERE status = 'approuvee'").count;
        const refusees = queryOne("SELECT COUNT(*) as count FROM demandes WHERE status = 'refusee'").count;
        const promoAcceptees = queryOne("SELECT COUNT(*) as count FROM demandes WHERE promo_accepted = 'yes'").count;

        res.json({
            total,
            nouvelles,
            enCours,
            approuvees,
            refusees,
            promoAcceptees
        });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// =====================================================
// Serve Pages
// =====================================================

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'login.html'));
});

app.get('/admin/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin', 'dashboard.html'));
});

// =====================================================
// Start Server
// =====================================================

initDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════════╗
║     Les Jardins du Saguenay - Serveur démarré             ║
╠════════════════════════════════════════════════════════════╣
║  Formulaire:  http://localhost:${PORT}                       ║
║  Admin:       http://localhost:${PORT}/admin                 ║
║  Dashboard:   http://localhost:${PORT}/admin/dashboard       ║
╠════════════════════════════════════════════════════════════╣
║  Identifiants par défaut:                                 ║
║  Username: admin                                          ║
║  Password: admin123                                       ║
╚════════════════════════════════════════════════════════════╝
        `);
    });
}).catch(err => {
    console.error('Erreur lors de l\'initialisation de la base de données:', err);
    process.exit(1);
});
