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
        const doc = new PDFDocument({ margin: 50, size: 'LETTER', bufferPages: true });

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
        const W = 612;        // page width
        const M = 50;         // margin
        const CW = W - M * 2; // content width (512)

        // ---- Helpers (all use absolute y, never touch doc.y for flow) ----

        // Measure text height at given font settings
        function textH(str, opts) {
            return doc.heightOfString(str, opts);
        }

        // Draw text at absolute position, return y after text
        function drawText(str, x, atY, opts) {
            opts = Object.assign({ lineBreak: true }, opts);
            doc.text(str, x, atY, opts);
            return atY + textH(str, opts);
        }

        // Draw signature image or text into a box area
        function drawSignature(x, atY, w, h) {
            if (demande.signature && demande.signature.startsWith('data:image')) {
                try {
                    const b64 = demande.signature.replace(/^data:image\/png;base64,/, '');
                    const buf = Buffer.from(b64, 'base64');
                    doc.image(buf, x + 8, atY + 4, { fit: [w - 16, h - 12] });
                } catch (e) {
                    doc.fontSize(9).font('Helvetica-Oblique').fillColor('#aaa')
                        .text('[Signature]', x + w / 2 - 25, atY + h / 2 - 5, { lineBreak: false });
                }
            } else if (demande.signature) {
                doc.fontSize(15).font('Helvetica-Oblique').fillColor('#333')
                    .text(demande.signature, x + 10, atY + h / 2 - 8, { lineBreak: false });
            }
        }

        // =====================================================
        // PAGE 1 — FICHE CLIENT
        // =====================================================

        // Orange top stripe
        doc.rect(0, 0, W, 5).fill('#FF7A00');

        // Header
        doc.fontSize(20).font('Helvetica-Bold').fillColor('#FF7A00')
            .text('Les Jardins du Saguenay', M, 22, { width: CW, align: 'center', lineBreak: false });
        doc.fontSize(8).font('Helvetica').fillColor('#aaa')
            .text('Distributeur alimentaire depuis plus de 40 ans', M, 46, { width: CW, align: 'center', lineBreak: false });

        // Title bar
        doc.rect(M, 62, CW, 28).fill('#FF7A00');
        doc.fontSize(13).font('Helvetica-Bold').fillColor('white')
            .text('FICHE CLIENT', M + 12, 68, { lineBreak: false });
        doc.fontSize(9).font('Helvetica').fillColor('white')
            .text(`Dossier #${demande.id}  |  ${dateCreation}`, M, 70, { width: CW - 12, align: 'right', lineBreak: false });

        // Status badge
        const statusText = demande.status === 'approuvee' ? 'APPROUVÉ' : demande.status === 'refusee' ? 'REFUSÉ' : 'EN ATTENTE';
        const statusColor = demande.status === 'approuvee' ? '#16a34a' : demande.status === 'refusee' ? '#dc2626' : '#d97706';

        let y = 102;

        // --- Section: Entreprise ---
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#FF7A00')
            .text('ENTREPRISE', M, y, { lineBreak: false });
        doc.moveTo(M, y + 14).lineTo(M + CW, y + 14).lineWidth(0.5).stroke('#e5e5e5');
        y += 22;

        const labelW = 155;
        const valX = M + labelW;
        const valW = CW - labelW;
        const rowH = 17;

        function fieldRow(label, value, atY) {
            doc.fontSize(9).font('Helvetica').fillColor('#888')
                .text(label, M, atY, { width: labelW, lineBreak: false });
            doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#333')
                .text(value || '—', valX, atY, { width: valW, lineBreak: false });
            return atY + rowH;
        }

        y = fieldRow('Nom de l\'entreprise', demande.company_name, y);
        y = fieldRow('Propriétaire', demande.owner_name, y);
        if (demande.contact_name && demande.contact_name !== demande.owner_name) {
            y = fieldRow('Personne contact', demande.contact_name, y);
        }
        y = fieldRow('Adresse', demande.address, y);
        y = fieldRow('Ville', `${demande.city}, ${demande.postal_code}`, y);
        y += 10;

        // --- Section: Activité ---
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#FF7A00')
            .text('ACTIVITÉ', M, y, { lineBreak: false });
        doc.moveTo(M, y + 14).lineTo(M + CW, y + 14).lineWidth(0.5).stroke('#e5e5e5');
        y += 22;

        y = fieldRow('Secteur d\'activité', sectorLabels[demande.sector] || demande.sector, y);
        y = fieldRow('Volume d\'achat annuel', `${demande.annual_purchase}`, y);

        if (hasPromo) {
            doc.fontSize(9).font('Helvetica').fillColor('#888')
                .text('Programme ristourne', M, y, { width: labelW, lineBreak: false });
            doc.fontSize(9.5).font('Helvetica-Bold').fillColor('#16a34a')
                .text(`Accepté — 2% sur min. ${minOrderAmount}/an`, valX, y, { width: valW, lineBreak: false });
            y += rowH;
        } else {
            y = fieldRow('Programme ristourne', 'Non souscrit', y);
        }
        y += 10;

        // --- Section: Coordonnées ---
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#FF7A00')
            .text('COORDONNÉES', M, y, { lineBreak: false });
        doc.moveTo(M, y + 14).lineTo(M + CW, y + 14).lineWidth(0.5).stroke('#e5e5e5');
        y += 22;

        y = fieldRow('Courriel responsable', demande.email_responsable, y);
        y = fieldRow('Courriel facturation', demande.email_facturation, y);
        y = fieldRow('Téléphone', demande.phone, y);
        y += 10;

        // --- Section: Signature ---
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#FF7A00')
            .text('SIGNATURE ÉLECTRONIQUE', M, y, { lineBreak: false });

        // Status badge (right-aligned next to signature title)
        const badgeW = doc.widthOfString(statusText) + 14;
        doc.roundedRect(M + CW - badgeW, y - 2, badgeW, 16, 8).fill(statusColor);
        doc.fontSize(7).font('Helvetica-Bold').fillColor('white')
            .text(statusText, M + CW - badgeW, y + 1, { width: badgeW, align: 'center', lineBreak: false });

        doc.moveTo(M, y + 14).lineTo(M + CW, y + 14).lineWidth(0.5).stroke('#e5e5e5');
        y += 22;

        // Signature box
        const sigW = 200;
        const sigH = 60;
        doc.rect(M, y, sigW, sigH).lineWidth(0.5).stroke('#ddd');
        drawSignature(M, y, sigW, sigH);

        // Date + info next to sig
        doc.fontSize(8).font('Helvetica').fillColor('#888')
            .text('Date de signature', M + sigW + 20, y + 4, { lineBreak: false });
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#333')
            .text(dateCreation, M + sigW + 20, y + 16, { lineBreak: false });
        doc.fontSize(8).font('Helvetica').fillColor('#888')
            .text('Signataire', M + sigW + 20, y + 34, { lineBreak: false });
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#333')
            .text(demande.owner_name, M + sigW + 20, y + 46, { lineBreak: false });

        // Footer page 1
        doc.fontSize(7).font('Helvetica').fillColor('#ccc')
            .text('Les Jardins du Saguenay  •  418 542-1797  •  lesjardinsdusaguenay.com', M, 740, { width: CW, align: 'center', lineBreak: false });
        doc.text('Page 1 de 2', M, 752, { width: CW, align: 'center', lineBreak: false });

        // =====================================================
        // PAGE 2 — CONDITIONS GÉNÉRALES D'APPROVISIONNEMENT
        // =====================================================
        doc.addPage();

        // Orange top stripe
        doc.rect(0, 0, W, 5).fill('#FF7A00');

        // Header
        doc.fontSize(16).font('Helvetica-Bold').fillColor('#FF7A00')
            .text('Les Jardins du Saguenay', M, 18, { width: CW, align: 'center', lineBreak: false });

        // Title bar
        doc.rect(M, 40, CW, 22).fill('#333');
        doc.fontSize(10).font('Helvetica-Bold').fillColor('white')
            .text('CONDITIONS GÉNÉRALES D\'APPROVISIONNEMENT', M, 46, { width: CW, align: 'center', lineBreak: false });

        // Client info line
        doc.fontSize(8).font('Helvetica').fillColor('#666');
        let infoLine = `Client: ${demande.company_name}  |  Dossier #${demande.id}  |  ${dateCreation}`;
        if (hasPromo) infoLine += `  |  Engagement: ${minOrderAmount}/an — Ristourne 2%`;
        doc.text(infoLine, M, 68, { width: CW, align: 'center', lineBreak: false });

        y = 84;

        // Contract text settings
        const fs = 8;   // body font size
        const hs = 9;   // heading font size
        const sp = 3;    // spacing after bullet
        const secSp = 7; // spacing after section

        function heading(num, title, color) {
            doc.fontSize(hs).font('Helvetica-Bold').fillColor(color || '#333')
                .text(`${num ? num + '. ' : ''}${title}`, M, y, { width: CW, lineBreak: false });
            y += 13;
        }

        function bul(text) {
            doc.fontSize(fs).font('Helvetica').fillColor('#444');
            const h = textH('• ' + text, { width: CW - 12 });
            doc.text('• ' + text, M + 12, y, { width: CW - 12 });
            y += h + sp;
        }

        // === PROMO CLAUSES ===
        if (hasPromo) {
            // Orange left border for engagement
            const engY = y;
            heading('', 'ENGAGEMENT D\'ACHAT MINIMUM', '#FF7A00');
            bul(`Vous vous engagez à acheter un volume minimal annuel de ${minOrderAmount} de Produits.`);
            bul('En contrepartie, vous bénéficiez d\'une ristourne de 2% sur tous vos achats pendant 12 mois.');
            bul('Cet engagement débute à la date de création de votre compte pour une période de 12 mois.');
            doc.rect(M, engY, 3, y - engY - sp).fill('#FF7A00');
            y += 4;

            // Red left border for penalty
            const penY = y;
            heading('', 'PÉNALITÉ SI VOLUME NON ATTEINT', '#dc2626');
            bul(`Si vous n'atteignez pas le volume minimal de ${minOrderAmount} à la fin des 12 mois, vous devrez payer une pénalité de 15% du volume minimal non atteint.`);
            bul('Cette pénalité sera calculée à la fin de la période et payable dans les 30 jours.');
            bul(`Exemple: achat de 30 000$ sur engagement de 40 000$ = pénalité de 15% × 10 000$ = 1 500$.`);
            doc.rect(M, penY, 3, y - penY - sp).fill('#dc2626');
            y += 4;

            // Thin separator
            doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.3).stroke('#ddd');
            y += 6;
        }

        // === STANDARD CONDITIONS ===
        heading('1', 'COMMANDES');
        bul('Vous commandez les Produits par bon de commande électronique sur notre plateforme.');
        bul('Nous confirmons votre commande par courriel dans l\'heure ouvrable suivante.');
        bul('Tous les prix sont selon notre liste de prix en vigueur (taxes en sus).');
        y += secSp;

        heading('2', 'MODIFICATION ET ANNULATION');
        bul('Vous pouvez modifier ou annuler votre commande jusqu\'à 24 heures avant la livraison.');
        bul(hasPromo
            ? 'Annulation tardive ou refus de livraison: frais de désengagement de 10% du montant.'
            : 'Annulation tardive ou refus de livraison: frais de désengagement de 50$.');
        y += secSp;

        heading('3', 'LIVRAISON');
        bul('Nous livrons les Produits à l\'adresse indiquée sur votre commande.');
        bul('Les frais de livraison sont facturés en sus selon notre grille tarifaire.');
        bul('Vous devenez propriétaire et responsable des Produits dès leur livraison.');
        y += secSp;

        heading('4', 'QUALITÉ');
        bul('Les Produits sont emballés selon les règles de l\'art.');
        bul('Nous garantissons que les Produits sont aptes à la consommation à la date de livraison.');
        y += secSp;

        heading('5', 'PAIEMENT');
        bul('Le paiement est dû dans les 14 jours suivant la réception de la facture.');
        bul('En cas de retard: intérêts au taux préférentiel bancaire plus 15% par année.');
        bul('Solde impayé depuis plus de 30 jours: paiement à la livraison exigé.');
        if (hasPromo) {
            bul('En cas de non-paiement, la ristourne de 2% sera annulée rétroactivement.');
        }
        y += secSp;

        heading('6', 'CONFIDENTIALITÉ');
        bul('Toutes les informations relatives à nos prix et opérations sont confidentielles.');
        y += secSp;

        heading('7', 'RÉSILIATION');
        bul('Nous pouvons résilier votre compte sans avis en cas de non-paiement, manquement aux conditions, insolvabilité ou acte criminel.');
        if (hasPromo) {
            bul('En cas de résiliation, toutes les sommes dues (incluant les pénalités) deviennent immédiatement exigibles.');
        }
        y += secSp;

        heading('8', 'JURIDICTION');
        bul('Ce contrat est régi par les lois du Québec. Les tribunaux du district de Chicoutimi ont compétence exclusive pour tout litige.');
        y += 12;

        // === SIGNATURE DU CLIENT ===
        doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(0.5).stroke('#ddd');
        y += 10;

        doc.fontSize(9).font('Helvetica-Bold').fillColor('#333')
            .text('SIGNATURE DU CLIENT', M, y, { lineBreak: false });
        y += 14;

        doc.fontSize(8).font('Helvetica').fillColor('#555');
        if (hasPromo) {
            const confirmText = `En signant, je confirme avoir lu et accepté les conditions ci-dessus, m'engager au volume minimal annuel de ${minOrderAmount}, accepter la pénalité de 15% en cas de non-atteinte, et être autorisé(e) à engager l'entreprise.`;
            const confirmH = textH(confirmText, { width: CW });
            doc.text(confirmText, M, y, { width: CW });
            y += confirmH + 8;
        } else {
            const confirmText = 'En signant, je confirme avoir lu et accepté les conditions générales ci-dessus et être autorisé(e) à engager l\'entreprise.';
            const confirmH = textH(confirmText, { width: CW });
            doc.text(confirmText, M, y, { width: CW });
            y += confirmH + 8;
        }

        // Signature + Date boxes
        const sBoxW = 220;
        const sBoxH = 55;
        const dBoxX = M + sBoxW + 24;
        const dBoxW = CW - sBoxW - 24;

        // Signature box
        doc.rect(M, y, sBoxW, sBoxH).lineWidth(0.5).stroke('#ccc');
        drawSignature(M, y, sBoxW, sBoxH);
        doc.fontSize(7).font('Helvetica').fillColor('#aaa')
            .text('Signature du client', M + 6, y + sBoxH + 3, { lineBreak: false });

        // Date box
        doc.rect(dBoxX, y, dBoxW, sBoxH).lineWidth(0.5).stroke('#ccc');
        doc.fontSize(10).font('Helvetica').fillColor('#333')
            .text(dateCreation, dBoxX + 10, y + sBoxH / 2 - 5, { lineBreak: false });
        doc.fontSize(7).font('Helvetica').fillColor('#aaa')
            .text('Date', dBoxX + 6, y + sBoxH + 3, { lineBreak: false });

        // Footer page 2
        doc.fontSize(7).font('Helvetica').fillColor('#ccc');
        doc.text('9051-2500 QUÉBEC INC. faisant affaires sous le nom Les Jardins du Saguenay', M, 730, { width: CW, align: 'center', lineBreak: false });
        doc.text('2380, rue Cantin, Saguenay, Québec, G7X 8S6  •  418 542-1797', M, 740, { width: CW, align: 'center', lineBreak: false });
        doc.text('Page 2 de 2', M, 750, { width: CW, align: 'center', lineBreak: false });

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
