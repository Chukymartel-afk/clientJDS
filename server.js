const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cors = require('cors');
const path = require('path');
const PDFDocument = require('pdfkit');

// Services
const { sendApprovalEmail, verifySmtpConnection } = require('./services/emailService');
const { createDadhriClient, verifyDadhriConnection } = require('./services/dadhriService');

const app = express();
const PORT = process.env.PORT || 3000;

// =====================================================
// Database Setup - PostgreSQL
// =====================================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
    const client = await pool.connect();
    try {
        // Create tables
        await client.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                nom VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS demandes (
                id SERIAL PRIMARY KEY,
                company_name VARCHAR(255) NOT NULL,
                owner_name VARCHAR(255) NOT NULL,
                contact_name VARCHAR(255),
                address TEXT NOT NULL,
                city VARCHAR(255) NOT NULL,
                postal_code VARCHAR(20) NOT NULL,
                sector VARCHAR(100) NOT NULL,
                annual_purchase VARCHAR(100) NOT NULL,
                promo_accepted VARCHAR(10),
                promo_min_order VARCHAR(100),
                email_responsable VARCHAR(255) NOT NULL,
                email_facturation VARCHAR(255) NOT NULL,
                phone VARCHAR(50) NOT NULL,
                signature TEXT NOT NULL,
                status VARCHAR(50) DEFAULT 'nouvelle',
                notes TEXT,
                dadhri_code VARCHAR(50),
                dadhri_synced_at TIMESTAMP,
                email_sent_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Migration: ajouter les nouvelles colonnes si elles n'existent pas
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'demandes' AND column_name = 'dadhri_code') THEN
                    ALTER TABLE demandes ADD COLUMN dadhri_code VARCHAR(50);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'demandes' AND column_name = 'dadhri_synced_at') THEN
                    ALTER TABLE demandes ADD COLUMN dadhri_synced_at TIMESTAMP;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'demandes' AND column_name = 'email_sent_at') THEN
                    ALTER TABLE demandes ADD COLUMN email_sent_at TIMESTAMP;
                END IF;
            END $$;
        `);

        // Analytics tables
        await client.query(`
            CREATE TABLE IF NOT EXISTS sessions (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) UNIQUE NOT NULL,
                device_type VARCHAR(50),
                browser VARCHAR(100),
                os VARCHAR(100),
                screen_width INTEGER,
                screen_height INTEGER,
                referrer TEXT,
                utm_source VARCHAR(255),
                utm_medium VARCHAR(255),
                utm_campaign VARCHAR(255),
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ended_at TIMESTAMP,
                completed INTEGER DEFAULT 0
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) NOT NULL,
                event_type VARCHAR(100) NOT NULL,
                event_data TEXT,
                step VARCHAR(20),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS step_times (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) NOT NULL,
                step VARCHAR(20) NOT NULL,
                time_spent INTEGER,
                entered_at TIMESTAMP,
                left_at TIMESTAMP
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS field_interactions (
                id SERIAL PRIMARY KEY,
                session_id VARCHAR(255) NOT NULL,
                field_name VARCHAR(100) NOT NULL,
                interaction_type VARCHAR(50),
                time_spent INTEGER,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Session store table
        await client.query(`
            CREATE TABLE IF NOT EXISTS "session" (
                "sid" varchar NOT NULL COLLATE "default",
                "sess" json NOT NULL,
                "expire" timestamp(6) NOT NULL,
                PRIMARY KEY ("sid")
            )
        `);

        await client.query(`
            CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")
        `);

        // Create default admin if none exists
        const adminResult = await client.query('SELECT COUNT(*) as count FROM admins');
        if (parseInt(adminResult.rows[0].count) === 0) {
            const hashedPassword = bcrypt.hashSync('admin123', 10);
            await client.query(
                'INSERT INTO admins (username, password, nom, email) VALUES ($1, $2, $3, $4)',
                ['admin', hashedPassword, 'Administrateur', 'admin@lesjardinsdusaguenay.com']
            );
            console.log('Admin par défaut créé: admin / admin123');
        }

        console.log('Base de données PostgreSQL initialisée');
    } finally {
        client.release();
    }
}

// =====================================================
// Middleware
// =====================================================

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'jardins-saguenay-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
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
app.post('/api/analytics/session', async (req, res) => {
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

        await pool.query(`
            INSERT INTO sessions (
                session_id, device_type, browser, os, screen_width, screen_height,
                referrer, utm_source, utm_medium, utm_campaign
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (session_id) DO UPDATE SET
                device_type = EXCLUDED.device_type,
                browser = EXCLUDED.browser,
                os = EXCLUDED.os
        `, [
            sessionId, deviceType, browser, os, screenWidth, screenHeight,
            referrer, utmSource, utmMedium, utmCampaign
        ]);

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics session error:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// Track an event
app.post('/api/analytics/event', async (req, res) => {
    try {
        const { sessionId, eventType, eventData, step } = req.body;

        await pool.query(`
            INSERT INTO events (session_id, event_type, event_data, step)
            VALUES ($1, $2, $3, $4)
        `, [sessionId, eventType, JSON.stringify(eventData || {}), step]);

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics event error:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// Track step timing
app.post('/api/analytics/step-time', async (req, res) => {
    try {
        const { sessionId, step, timeSpent, enteredAt, leftAt } = req.body;

        await pool.query(`
            INSERT INTO step_times (session_id, step, time_spent, entered_at, left_at)
            VALUES ($1, $2, $3, $4, $5)
        `, [sessionId, step, timeSpent, enteredAt, leftAt]);

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics step-time error:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// Track field interaction
app.post('/api/analytics/field', async (req, res) => {
    try {
        const { sessionId, fieldName, interactionType, timeSpent } = req.body;

        await pool.query(`
            INSERT INTO field_interactions (session_id, field_name, interaction_type, time_spent)
            VALUES ($1, $2, $3, $4)
        `, [sessionId, fieldName, interactionType, timeSpent]);

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics field error:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// End session
app.post('/api/analytics/session/end', async (req, res) => {
    try {
        const { sessionId, completed } = req.body;

        await pool.query(`
            UPDATE sessions SET ended_at = NOW(), completed = $1 WHERE session_id = $2
        `, [completed ? 1 : 0, sessionId]);

        res.json({ success: true });
    } catch (error) {
        console.error('Analytics session end error:', error);
        res.status(500).json({ error: 'Erreur' });
    }
});

// =====================================================
// API Routes - Analytics Stats (admin only)
// =====================================================

app.get('/api/analytics/overview', requireAuth, async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;

        // Total sessions
        const totalResult = await pool.query(
            `SELECT COUNT(*) as count FROM sessions WHERE started_at >= NOW() - INTERVAL '${days} days'`
        );
        const totalSessions = parseInt(totalResult.rows[0].count);

        // Completed sessions
        const completedResult = await pool.query(
            `SELECT COUNT(*) as count FROM sessions WHERE started_at >= NOW() - INTERVAL '${days} days' AND completed = 1`
        );
        const completedSessions = parseInt(completedResult.rows[0].count);

        // Conversion rate
        const conversionRate = totalSessions > 0 ? ((completedSessions / totalSessions) * 100).toFixed(1) : 0;

        // Average time on form
        const avgTimeResult = await pool.query(`
            SELECT AVG(EXTRACT(EPOCH FROM (ended_at - started_at))) as avg_time
            FROM sessions
            WHERE started_at >= NOW() - INTERVAL '${days} days' AND completed = 1 AND ended_at IS NOT NULL
        `);
        const avgTimeOnForm = avgTimeResult.rows[0].avg_time ? Math.round(avgTimeResult.rows[0].avg_time) : 0;

        // Device breakdown
        const devicesResult = await pool.query(`
            SELECT device_type, COUNT(*) as count
            FROM sessions
            WHERE started_at >= NOW() - INTERVAL '${days} days'
            GROUP BY device_type
        `);

        // Sessions by day
        const sessionsByDayResult = await pool.query(`
            SELECT DATE(started_at) as date,
                   COUNT(*) as total,
                   SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed
            FROM sessions
            WHERE started_at >= NOW() - INTERVAL '${days} days'
            GROUP BY DATE(started_at)
            ORDER BY date ASC
        `);

        // Sessions by hour
        const sessionsByHourResult = await pool.query(`
            SELECT EXTRACT(HOUR FROM started_at)::INTEGER as hour, COUNT(*) as count
            FROM sessions
            WHERE started_at >= NOW() - INTERVAL '${days} days'
            GROUP BY hour
            ORDER BY hour ASC
        `);

        res.json({
            totalSessions,
            completedSessions,
            conversionRate: parseFloat(conversionRate),
            avgTimeOnForm,
            devices: devicesResult.rows,
            sessionsByDay: sessionsByDayResult.rows,
            sessionsByHour: sessionsByHourResult.rows
        });
    } catch (error) {
        console.error('Analytics overview error:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/analytics/funnel', requireAuth, async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;

        const steps = ['1', '2', '3', 'success'];
        const funnel = [];

        for (const step of steps) {
            const result = await pool.query(`
                SELECT COUNT(DISTINCT session_id) as count
                FROM step_times
                WHERE step = $1 AND session_id IN (
                    SELECT session_id FROM sessions WHERE started_at >= NOW() - INTERVAL '${days} days'
                )
            `, [step]);
            funnel.push({ step, count: parseInt(result.rows[0].count) });
        }

        const stepTimesResult = await pool.query(`
            SELECT step, AVG(time_spent) as avg_time
            FROM step_times
            WHERE session_id IN (
                SELECT session_id FROM sessions WHERE started_at >= NOW() - INTERVAL '${days} days'
            )
            GROUP BY step
        `);

        res.json({ funnel, stepTimes: stepTimesResult.rows });
    } catch (error) {
        console.error('Analytics funnel error:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/analytics/promo', requireAuth, async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;

        const promoShownResult = await pool.query(`
            SELECT COUNT(*) as count FROM events
            WHERE event_type = 'promo_shown' AND timestamp >= NOW() - INTERVAL '${days} days'
        `);

        const promoAcceptedResult = await pool.query(`
            SELECT COUNT(*) as count FROM events
            WHERE event_type = 'promo_accepted' AND timestamp >= NOW() - INTERVAL '${days} days'
        `);

        const promoRefusedResult = await pool.query(`
            SELECT COUNT(*) as count FROM events
            WHERE event_type = 'promo_refused' AND timestamp >= NOW() - INTERVAL '${days} days'
        `);

        const promoShown = parseInt(promoShownResult.rows[0].count);
        const promoAccepted = parseInt(promoAcceptedResult.rows[0].count);
        const promoRefused = parseInt(promoRefusedResult.rows[0].count);

        res.json({
            promoShown,
            promoAccepted,
            promoRefused,
            avgPromoViewTime: 0,
            acceptanceRate: promoShown > 0 ? ((promoAccepted / promoShown) * 100).toFixed(1) : 0
        });
    } catch (error) {
        console.error('Analytics promo error:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/analytics/abandons', requireAuth, async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;

        const abandonsByStepResult = await pool.query(`
            SELECT st.step, COUNT(DISTINCT st.session_id) as count
            FROM step_times st
            JOIN sessions s ON st.session_id = s.session_id
            WHERE s.started_at >= NOW() - INTERVAL '${days} days' AND s.completed = 0
            GROUP BY st.step
        `);

        const fieldAbandonResult = await pool.query(`
            SELECT fi.field_name,
                   COUNT(*) as abandon_count,
                   AVG(fi.time_spent) as avg_time
            FROM field_interactions fi
            JOIN sessions s ON fi.session_id = s.session_id
            WHERE s.started_at >= NOW() - INTERVAL '${days} days' AND s.completed = 0
            GROUP BY fi.field_name
            ORDER BY abandon_count DESC
            LIMIT 10
        `);

        res.json({
            abandonsByStep: abandonsByStepResult.rows,
            fieldAbandonData: fieldAbandonResult.rows
        });
    } catch (error) {
        console.error('Analytics abandons error:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/analytics/sources', requireAuth, async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;

        const sourcesResult = await pool.query(`
            SELECT
                COALESCE(utm_source, 'direct') as source,
                COUNT(*) as total,
                SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as completed
            FROM sessions
            WHERE started_at >= NOW() - INTERVAL '${days} days'
            GROUP BY COALESCE(utm_source, 'direct')
            ORDER BY total DESC
        `);

        const referrersResult = await pool.query(`
            SELECT
                CASE
                    WHEN referrer IS NULL OR referrer = '' THEN 'Direct'
                    ELSE referrer
                END as referrer,
                COUNT(*) as count
            FROM sessions
            WHERE started_at >= NOW() - INTERVAL '${days} days'
            GROUP BY referrer
            ORDER BY count DESC
            LIMIT 10
        `);

        res.json({ sources: sourcesResult.rows, referrers: referrersResult.rows });
    } catch (error) {
        console.error('Analytics sources error:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

app.get('/api/analytics/realtime', requireAuth, async (req, res) => {
    try {
        const activeSessionsResult = await pool.query(`
            SELECT DISTINCT s.session_id, s.device_type, s.started_at,
                   (SELECT step FROM step_times WHERE session_id = s.session_id ORDER BY entered_at DESC LIMIT 1) as current_step
            FROM sessions s
            JOIN events e ON s.session_id = e.session_id
            WHERE e.timestamp >= NOW() - INTERVAL '5 minutes'
            ORDER BY e.timestamp DESC
        `);

        const recentCompletionsResult = await pool.query(`
            SELECT session_id, ended_at
            FROM sessions
            WHERE completed = 1 AND ended_at >= NOW() - INTERVAL '5 minutes'
            ORDER BY ended_at DESC
            LIMIT 10
        `);

        res.json({
            activeCount: activeSessionsResult.rows.length,
            activeSessions: activeSessionsResult.rows,
            recentCompletions: recentCompletionsResult.rows
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
app.post('/api/demandes', async (req, res) => {
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

        const result = await pool.query(`
            INSERT INTO demandes (
                company_name, owner_name, contact_name, address, city, postal_code,
                sector, annual_purchase, promo_accepted, promo_min_order,
                email_responsable, email_facturation, phone, signature
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id
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
            signature
        ]);

        res.json({
            success: true,
            message: 'Demande soumise avec succès',
            id: result.rows[0].id
        });
    } catch (error) {
        console.error('Erreur:', error);
        res.status(500).json({ error: 'Erreur lors de la soumission' });
    }
});

// Get all demandes (admin only)
app.get('/api/demandes', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM demandes ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Get single demande (admin only)
app.get('/api/demandes/:id', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM demandes WHERE id = $1', [parseInt(req.params.id)]);
        if (result.rows.length > 0) {
            res.json(result.rows[0]);
        } else {
            res.status(404).json({ error: 'Demande non trouvée' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Update demande status (admin only)
app.patch('/api/demandes/:id', requireAuth, async (req, res) => {
    try {
        const { status, notes } = req.body;
        const demandeId = parseInt(req.params.id);

        // Récupérer l'état actuel de la demande
        const currentResult = await pool.query('SELECT * FROM demandes WHERE id = $1', [demandeId]);
        if (currentResult.rows.length === 0) {
            return res.status(404).json({ error: 'Demande non trouvée' });
        }

        const demande = currentResult.rows[0];
        const wasApproved = demande.status === 'approuvee';
        const isBeingApproved = status === 'approuvee' && !wasApproved;

        // Mettre à jour le statut
        await pool.query(
            'UPDATE demandes SET status = $1, notes = $2, updated_at = NOW() WHERE id = $3',
            [status, notes, demandeId]
        );

        let emailResult = null;
        let dadhriResult = null;

        // Si le statut passe à "approuvee", déclencher email et création Dadhri
        if (isBeingApproved) {
            // Récupérer les données fraîches
            const freshResult = await pool.query('SELECT * FROM demandes WHERE id = $1', [demandeId]);
            const freshDemande = freshResult.rows[0];

            // 1. Envoyer l'email de confirmation
            emailResult = await sendApprovalEmail(freshDemande);
            if (emailResult.success) {
                await pool.query(
                    'UPDATE demandes SET email_sent_at = NOW() WHERE id = $1',
                    [demandeId]
                );
            }

            // 2. Créer le client dans Dadhri
            dadhriResult = await createDadhriClient(freshDemande);
            if (dadhriResult.success) {
                await pool.query(
                    'UPDATE demandes SET dadhri_code = $1, dadhri_synced_at = NOW() WHERE id = $2',
                    [dadhriResult.clientCode, demandeId]
                );
            }

            console.log(`Demande #${demandeId} approuvée - Email: ${emailResult.success ? 'OK' : 'ÉCHEC'}, Dadhri: ${dadhriResult.success ? dadhriResult.clientCode : 'ÉCHEC'}`);
        }

        res.json({
            success: true,
            email: emailResult,
            dadhri: dadhriResult
        });
    } catch (error) {
        console.error('Erreur mise à jour demande:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Delete demande (admin only)
app.delete('/api/demandes/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM demandes WHERE id = $1', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Generate PDF for demande (admin only)
app.get('/api/demandes/:id/pdf', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM demandes WHERE id = $1', [parseInt(req.params.id)]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Demande non trouvée' });
        }

        const demande = result.rows[0];
        const doc = new PDFDocument({ margin: 50, size: 'LETTER' });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=demande-${demande.id}-${demande.company_name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);

        doc.pipe(res);

        const dateCreation = new Date(demande.created_at).toLocaleDateString('fr-CA', {
            year: 'numeric', month: 'long', day: 'numeric'
        });

        const sectorLabels = {
            'restaurant': 'Restaurant',
            'hotellerie': 'Hôtellerie',
            'residence': 'Résidence pour aînés',
            'epicerie': 'Épicerie',
            'depanneur': 'Dépanneur',
            'autre': 'Autre'
        };

        const hasPromo = demande.promo_accepted === 'yes';
        const minOrderAmount = demande.promo_min_order || '$0';
        const pageWidth = 612;
        const marginLeft = 50;
        const marginRight = 50;
        const contentWidth = pageWidth - marginLeft - marginRight;

        // Helper: draw a section header bar
        function drawSectionHeader(text, y) {
            doc.save();
            doc.roundedRect(marginLeft, y, contentWidth, 24, 3).fill('#FF7A00');
            doc.fontSize(10).font('Helvetica-Bold').fillColor('white').text(text, marginLeft + 10, y + 7, { width: contentWidth - 20 });
            doc.restore();
            doc.fillColor('#333');
            return y + 32;
        }

        // Helper: draw a field row (label: value)
        function drawField(label, value, x, y, labelWidth) {
            labelWidth = labelWidth || 160;
            doc.fontSize(10).font('Helvetica').fillColor('#666').text(label, x, y, { width: labelWidth });
            doc.font('Helvetica-Bold').fillColor('#333').text(value || '—', x + labelWidth, y, { width: contentWidth - labelWidth - (x - marginLeft) });
            return y + 18;
        }

        // =====================================================
        // PAGE 1: FICHE CLIENT
        // =====================================================

        // Top orange accent bar
        doc.rect(0, 0, pageWidth, 6).fill('#FF7A00');

        // Company header
        doc.fontSize(22).font('Helvetica-Bold').fillColor('#FF7A00').text('Les Jardins du Saguenay', marginLeft, 30, { align: 'center', width: contentWidth });
        doc.fontSize(9).font('Helvetica').fillColor('#999').text('Distributeur alimentaire depuis plus de 40 ans', marginLeft, 56, { align: 'center', width: contentWidth });

        // Thin separator
        doc.moveTo(marginLeft + 150, 74).lineTo(pageWidth - marginRight - 150, 74).lineWidth(0.5).stroke('#ddd');

        // Document title + meta info
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#333').text('FICHE CLIENT', marginLeft, 86, { width: contentWidth });
        doc.fontSize(9).font('Helvetica').fillColor('#999');
        doc.text(`Dossier #${demande.id}`, marginLeft, 88, { width: contentWidth, align: 'right' });
        doc.text(dateCreation, marginLeft, 100, { width: contentWidth, align: 'right' });

        // Status badge
        const statusText = demande.status === 'approuvee' ? 'Approuvé' : demande.status === 'refusee' ? 'Refusé' : 'En attente';
        const statusColor = demande.status === 'approuvee' ? '#22c55e' : demande.status === 'refusee' ? '#ef4444' : '#f59e0b';
        const statusWidth = doc.widthOfString(statusText) + 16;
        const statusX = pageWidth - marginRight - statusWidth;
        doc.roundedRect(statusX, 112, statusWidth, 18, 9).fill(statusColor);
        doc.fontSize(8).font('Helvetica-Bold').fillColor('white').text(statusText, statusX, 116, { width: statusWidth, align: 'center' });

        // Horizontal line under header
        doc.moveTo(marginLeft, 140).lineTo(pageWidth - marginRight, 140).lineWidth(1).stroke('#eee');

        // SECTION: Entreprise
        let y = drawSectionHeader('INFORMATIONS DE L\'ENTREPRISE', 152);
        y = drawField('Nom de l\'entreprise', demande.company_name, marginLeft, y);
        y = drawField('Propriétaire', demande.owner_name, marginLeft, y);
        if (demande.contact_name && demande.contact_name !== demande.owner_name) {
            y = drawField('Personne contact', demande.contact_name, marginLeft, y);
        }
        y = drawField('Adresse', `${demande.address}, ${demande.city}, ${demande.postal_code}`, marginLeft, y);
        y += 12;

        // SECTION: Activité
        y = drawSectionHeader('ACTIVITÉ', y);
        y = drawField('Secteur d\'activité', sectorLabels[demande.sector] || demande.sector, marginLeft, y);
        y = drawField('Volume d\'achat annuel estimé', `${demande.annual_purchase}`, marginLeft, y);
        if (hasPromo) {
            doc.fontSize(10).font('Helvetica').fillColor('#666').text('Programme ristourne 2%', marginLeft, y, { width: 160 });
            doc.font('Helvetica-Bold').fillColor('#22c55e').text(`Accepté (min. ${minOrderAmount}/an)`, marginLeft + 160, y);
            doc.fillColor('#333');
            y += 18;
        }
        y += 12;

        // SECTION: Coordonnées
        y = drawSectionHeader('COORDONNÉES', y);
        y = drawField('Courriel responsable', demande.email_responsable, marginLeft, y);
        y = drawField('Courriel facturation', demande.email_facturation, marginLeft, y);
        y = drawField('Téléphone', demande.phone, marginLeft, y);
        y += 12;

        // SECTION: Signature
        y = drawSectionHeader('SIGNATURE', y);

        // Signature box
        doc.roundedRect(marginLeft, y, 220, 70, 3).lineWidth(1).stroke('#ddd');

        if (demande.signature && demande.signature.startsWith('data:image')) {
            try {
                const base64Data = demande.signature.replace(/^data:image\/png;base64,/, '');
                const signatureBuffer = Buffer.from(base64Data, 'base64');
                doc.image(signatureBuffer, marginLeft + 10, y + 5, { fit: [200, 60] });
            } catch (imgError) {
                doc.fontSize(10).font('Helvetica-Oblique').fillColor('#999').text('[Signature]', marginLeft + 70, y + 28);
            }
        } else {
            doc.fontSize(16).font('Helvetica-Oblique').fillColor('#333').text(demande.signature || '', marginLeft + 15, y + 22);
        }

        // Date beside signature
        doc.fontSize(9).font('Helvetica').fillColor('#666').text('Signé électroniquement le', marginLeft + 240, y + 20);
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#333').text(dateCreation, marginLeft + 240, y + 34);

        // Footer page 1
        doc.fontSize(7).font('Helvetica').fillColor('#bbb');
        doc.text('Les Jardins du Saguenay | 418 542-1797 | lesjardinsdusaguenay.com', marginLeft, 740, { width: contentWidth, align: 'center' });
        doc.text('Page 1 sur 2', marginLeft, 752, { width: contentWidth, align: 'center' });

        // =====================================================
        // PAGE 2: CONDITIONS GÉNÉRALES
        // =====================================================
        doc.addPage();

        // Top accent bar
        doc.rect(0, 0, pageWidth, 6).fill('#FF7A00');

        // Header
        doc.fontSize(18).font('Helvetica-Bold').fillColor('#FF7A00').text('Les Jardins du Saguenay', marginLeft, 24, { width: contentWidth, align: 'center' });
        doc.moveDown(0.3);

        doc.fontSize(13).font('Helvetica-Bold').fillColor('#333').text('CONDITIONS GÉNÉRALES D\'APPROVISIONNEMENT', marginLeft, 48, { width: contentWidth, align: 'center' });

        // Client info bar
        let infoBarY = 72;
        const infoBarHeight = hasPromo ? 48 : 32;
        doc.roundedRect(marginLeft, infoBarY, contentWidth, infoBarHeight, 4).fill('#f8f8f8');
        doc.roundedRect(marginLeft, infoBarY, contentWidth, infoBarHeight, 4).lineWidth(0.5).stroke('#e0e0e0');

        doc.fontSize(9).font('Helvetica-Bold').fillColor('#333');
        doc.text(`Client: ${demande.company_name}`, marginLeft + 12, infoBarY + 8);
        doc.font('Helvetica').fillColor('#666');
        doc.text(`Dossier #${demande.id} — ${dateCreation}`, marginLeft + 12, infoBarY + 8, { width: contentWidth - 24, align: 'right' });

        if (hasPromo) {
            doc.fontSize(9).font('Helvetica-Bold').fillColor('#FF7A00');
            doc.text(`Engagement d'achat minimum: ${minOrderAmount}/an — Ristourne: 2%`, marginLeft + 12, infoBarY + 26);
        }

        y = infoBarY + infoBarHeight + 14;

        // Contract body font size
        const bodySize = 8.5;
        const headingSize = 9.5;
        const lineHeight = 13;

        // Helper: contract section heading
        function contractHeading(num, title, color) {
            doc.fontSize(headingSize).font('Helvetica-Bold').fillColor(color || '#333').text(`${num}${num ? '. ' : ''}${title}`, marginLeft, y);
            y = doc.y + 3;
        }

        // Helper: contract bullet
        function bullet(text) {
            doc.fontSize(bodySize).font('Helvetica').fillColor('#444');
            doc.text(`  •  ${text}`, marginLeft, y, { width: contentWidth, lineGap: 1 });
            y = doc.y + 2;
        }

        // Promo-specific clauses
        if (hasPromo) {
            // Engagement box
            doc.roundedRect(marginLeft, y, contentWidth, 0.1, 0).fill('white'); // dummy to not affect y
            const engStartY = y;
            doc.save();
            doc.roundedRect(marginLeft, engStartY - 2, 4, 52, 2).fill('#FF7A00');
            doc.restore();

            contractHeading('', 'ENGAGEMENT D\'ACHAT MINIMUM', '#FF7A00');
            bullet(`Vous vous engagez à acheter un volume minimal annuel de ${minOrderAmount} de Produits.`);
            bullet('En contrepartie, vous bénéficiez d\'une ristourne de 2% sur tous vos achats pendant 12 mois.');
            bullet('Cet engagement débute à la date de création de votre compte pour une période de 12 mois.');
            y += 6;

            // Penalty box
            const penStartY = y;
            doc.save();
            doc.roundedRect(marginLeft, penStartY - 2, 4, 68, 2).fill('#dc2626');
            doc.restore();

            contractHeading('', 'PÉNALITÉ SI VOLUME NON ATTEINT', '#dc2626');
            bullet(`Si vous n'atteignez pas le volume minimal de ${minOrderAmount} à la fin des 12 mois, vous devrez payer une pénalité de 15% du volume minimal non atteint.`);
            bullet('Cette pénalité sera calculée à la fin de la période et payable dans les 30 jours.');
            bullet(`Exemple: Si vous achetez 30 000$ sur un engagement de 40 000$, la pénalité sera de 15% x 10 000$ = 1 500$.`);
            y += 8;
        }

        // Standard conditions
        contractHeading('1', 'COMMANDES');
        bullet('Vous commandez les Produits par bon de commande électronique sur notre plateforme.');
        bullet('Nous confirmons votre commande par courriel dans les 1 heures ouvrables.');
        bullet('Tous les prix sont selon notre liste de prix en vigueur (taxes en sus).');
        y += 5;

        contractHeading('2', 'MODIFICATION ET ANNULATION');
        bullet('Vous pouvez modifier ou annuler votre commande jusqu\'à 24 heures avant la livraison.');
        bullet(hasPromo
            ? 'Annulation tardive ou refus de livraison: frais de désengagement de 10% du montant.'
            : 'Annulation tardive ou refus de livraison: frais de désengagement de 50$.');
        y += 5;

        contractHeading('3', 'LIVRAISON');
        bullet('Nous livrons les Produits à l\'adresse indiquée sur votre commande.');
        bullet('Les frais de livraison sont facturés en sus selon notre grille tarifaire.');
        bullet('Vous devenez propriétaire et responsable des Produits dès leur livraison.');
        y += 5;

        contractHeading('4', 'QUALITÉ');
        bullet('Les Produits sont emballés selon les règles de l\'art.');
        bullet('Nous garantissons que les Produits sont aptes à la consommation à la date de livraison.');
        y += 5;

        contractHeading('5', 'PAIEMENT');
        bullet('Le paiement est dû dans les 14 jours suivant la réception de la facture.');
        bullet('En cas de retard: intérêts au taux préférentiel bancaire plus 15% par année.');
        bullet('Solde impayé depuis plus de 30 jours: paiement à la livraison exigé.');
        if (hasPromo) {
            bullet('En cas de non-paiement, la ristourne de 2% sera annulée rétroactivement.');
        }
        y += 5;

        contractHeading('6', 'CONFIDENTIALITÉ');
        bullet('Toutes les informations relatives à nos prix et opérations sont confidentielles.');
        y += 5;

        contractHeading('7', 'RÉSILIATION');
        bullet('Nous pouvons résilier votre compte sans avis en cas de non-paiement, manquement aux conditions, insolvabilité ou acte criminel.');
        if (hasPromo) {
            bullet('En cas de résiliation, toutes les sommes dues (incluant les pénalités) deviennent immédiatement exigibles.');
        }
        y += 5;

        contractHeading('8', 'JURIDICTION');
        bullet('Ce contrat est régi par les lois du Québec. Les tribunaux du district de Chicoutimi ont compétence exclusive pour tout litige.');
        y += 14;

        // Separator
        doc.moveTo(marginLeft, y).lineTo(pageWidth - marginRight, y).lineWidth(0.5).stroke('#ddd');
        y += 12;

        // Signature section
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#333').text('SIGNATURE DU CLIENT', marginLeft, y);
        y += 16;

        doc.fontSize(8.5).font('Helvetica').fillColor('#444');
        if (hasPromo) {
            doc.text('En signant ce document, je confirme:', marginLeft, y, { width: contentWidth });
            y = doc.y + 2;
            doc.text(`  •  Avoir lu et accepté l'intégralité des conditions générales ci-dessus.`, marginLeft, y, { width: contentWidth });
            y = doc.y + 2;
            doc.text(`  •  M'engager à acheter le volume minimal annuel de ${minOrderAmount}.`, marginLeft, y, { width: contentWidth });
            y = doc.y + 2;
            doc.text('  •  Accepter de payer la pénalité de 15% si je n\'atteins pas le volume minimal.', marginLeft, y, { width: contentWidth });
            y = doc.y + 2;
            doc.text('  •  Être autorisé(e) à engager l\'entreprise.', marginLeft, y, { width: contentWidth });
            y = doc.y + 10;
        } else {
            doc.text('En signant ce document, je confirme avoir lu et accepté l\'intégralité des conditions générales ci-dessus. Je confirme être autorisé(e) à engager l\'entreprise.', marginLeft, y, { width: contentWidth });
            y = doc.y + 10;
        }

        // Signature and date boxes side by side
        const sigBoxW = 240;
        const sigBoxH = 65;
        const dateBoxX = marginLeft + sigBoxW + 30;

        doc.roundedRect(marginLeft, y, sigBoxW, sigBoxH, 3).lineWidth(0.5).stroke('#ccc');
        doc.fontSize(7).font('Helvetica').fillColor('#999').text('Signature', marginLeft + 8, y + sigBoxH - 12);

        if (demande.signature && demande.signature.startsWith('data:image')) {
            try {
                const base64Data = demande.signature.replace(/^data:image\/png;base64,/, '');
                const signatureBuffer = Buffer.from(base64Data, 'base64');
                doc.image(signatureBuffer, marginLeft + 10, y + 3, { fit: [sigBoxW - 20, sigBoxH - 18] });
            } catch (imgError) {
                doc.fontSize(10).font('Helvetica-Oblique').fillColor('#999').text('[Signature électronique]', marginLeft + 50, y + 25);
            }
        } else {
            doc.fontSize(16).font('Helvetica-Oblique').fillColor('#333').text(demande.signature || '', marginLeft + 12, y + 18);
        }

        // Date box
        doc.roundedRect(dateBoxX, y, 180, sigBoxH, 3).lineWidth(0.5).stroke('#ccc');
        doc.fontSize(7).font('Helvetica').fillColor('#999').text('Date', dateBoxX + 8, y + sigBoxH - 12);
        doc.fontSize(11).font('Helvetica').fillColor('#333').text(dateCreation, dateBoxX + 12, y + 22);

        // Footer page 2
        doc.fontSize(7).font('Helvetica').fillColor('#bbb');
        doc.text('9051-2500 QUÉBEC INC. faisant affaires sous le nom Les Jardins du Saguenay', marginLeft, 730, { width: contentWidth, align: 'center' });
        doc.text('2380, rue Cantin, Saguenay, Québec, G7X 8S6 | 418 542-1797', marginLeft, 740, { width: contentWidth, align: 'center' });
        doc.text('Page 2 sur 2', marginLeft, 750, { width: contentWidth, align: 'center' });

        doc.end();

    } catch (error) {
        console.error('Erreur génération PDF:', error);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// =====================================================
// API Routes - Auth
// =====================================================

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);

        if (result.rows.length > 0 && bcrypt.compareSync(password, result.rows[0].password)) {
            const admin = result.rows[0];
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
app.get('/api/auth/me', async (req, res) => {
    if (req.session.adminId) {
        const result = await pool.query('SELECT id, username, nom, email FROM admins WHERE id = $1', [req.session.adminId]);
        if (result.rows.length > 0) {
            res.json({ authenticated: true, admin: result.rows[0] });
        } else {
            res.json({ authenticated: false });
        }
    } else {
        res.json({ authenticated: false });
    }
});

// =====================================================
// API Routes - Admin Management
// =====================================================

// Get all admins (admin only)
app.get('/api/admins', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, nom, email, created_at FROM admins');
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Create new admin (admin only)
app.post('/api/admins', requireAuth, async (req, res) => {
    try {
        const { username, password, nom, email } = req.body;

        const existing = await pool.query('SELECT id FROM admins WHERE username = $1', [username]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        const result = await pool.query(
            'INSERT INTO admins (username, password, nom, email) VALUES ($1, $2, $3, $4) RETURNING id',
            [username, hashedPassword, nom, email]
        );

        res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// Delete admin (admin only)
app.delete('/api/admins/:id', requireAuth, async (req, res) => {
    try {
        if (parseInt(req.params.id) === req.session.adminId) {
            return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
        }

        await pool.query('DELETE FROM admins WHERE id = $1', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// =====================================================
// API Routes - Stats
// =====================================================

app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const total = await pool.query('SELECT COUNT(*) as count FROM demandes');
        const nouvelles = await pool.query("SELECT COUNT(*) as count FROM demandes WHERE status = 'nouvelle'");
        const enCours = await pool.query("SELECT COUNT(*) as count FROM demandes WHERE status = 'en_cours'");
        const approuvees = await pool.query("SELECT COUNT(*) as count FROM demandes WHERE status = 'approuvee'");
        const refusees = await pool.query("SELECT COUNT(*) as count FROM demandes WHERE status = 'refusee'");
        const promoAcceptees = await pool.query("SELECT COUNT(*) as count FROM demandes WHERE promo_accepted = 'yes'");

        res.json({
            total: parseInt(total.rows[0].count),
            nouvelles: parseInt(nouvelles.rows[0].count),
            enCours: parseInt(enCours.rows[0].count),
            approuvees: parseInt(approuvees.rows[0].count),
            refusees: parseInt(refusees.rows[0].count),
            promoAcceptees: parseInt(promoAcceptees.rows[0].count)
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
║  Base de données: PostgreSQL (Cloud)                      ║
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
