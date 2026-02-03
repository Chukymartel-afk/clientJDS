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
        const doc = new PDFDocument({ margin: 50 });

        // Set response headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=demande-${demande.id}-${demande.company_name.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);

        doc.pipe(res);

        // Header
        doc.fontSize(24).font('Helvetica-Bold').text('Les Jardins du Saguenay', { align: 'center' });
        doc.fontSize(14).font('Helvetica').text('Demande d\'ouverture de compte', { align: 'center' });
        doc.moveDown(2);

        // Date de la demande
        const dateCreation = new Date(demande.created_at).toLocaleDateString('fr-CA', {
            year: 'numeric', month: 'long', day: 'numeric'
        });
        doc.fontSize(10).text(`Date de la demande: ${dateCreation}`, { align: 'right' });
        doc.text(`Numéro de demande: ${demande.id}`, { align: 'right' });
        doc.moveDown(2);

        // Section: Informations de l'entreprise
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#FF7A00').text('INFORMATIONS DE L\'ENTREPRISE');
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#FF7A00');
        doc.moveDown(0.5);
        doc.fillColor('black').font('Helvetica');

        doc.fontSize(11);
        doc.text(`Nom de l'entreprise: `, { continued: true }).font('Helvetica-Bold').text(demande.company_name);
        doc.font('Helvetica').text(`Propriétaire: `, { continued: true }).font('Helvetica-Bold').text(demande.owner_name);
        if (demande.contact_name && demande.contact_name !== demande.owner_name) {
            doc.font('Helvetica').text(`Personne contact: `, { continued: true }).font('Helvetica-Bold').text(demande.contact_name);
        }
        doc.font('Helvetica').text(`Adresse: `, { continued: true }).font('Helvetica-Bold').text(`${demande.address}, ${demande.city}, ${demande.postal_code}`);
        doc.moveDown(1.5);

        // Section: Activité
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#FF7A00').text('ACTIVITÉ');
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#FF7A00');
        doc.moveDown(0.5);
        doc.fillColor('black').font('Helvetica');

        const sectorLabels = {
            'restaurant': 'Restaurant',
            'hotellerie': 'Hôtellerie',
            'residence': 'Résidence pour aînés',
            'epicerie': 'Épicerie',
            'depanneur': 'Dépanneur',
            'autre': 'Autre'
        };

        doc.fontSize(11);
        doc.text(`Secteur d'activité: `, { continued: true }).font('Helvetica-Bold').text(sectorLabels[demande.sector] || demande.sector);
        doc.font('Helvetica').text(`Volume d'achat annuel estimé: `, { continued: true }).font('Helvetica-Bold').text(`$${demande.annual_purchase}`);

        if (demande.promo_accepted === 'yes') {
            doc.font('Helvetica').text(`Programme promo 2%: `, { continued: true }).font('Helvetica-Bold').fillColor('green').text(`Accepté (min. $${demande.promo_min_order}/an)`);
            doc.fillColor('black');
        }
        doc.moveDown(1.5);

        // Section: Coordonnées
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#FF7A00').text('COORDONNÉES');
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#FF7A00');
        doc.moveDown(0.5);
        doc.fillColor('black').font('Helvetica');

        doc.fontSize(11);
        doc.text(`Courriel responsable: `, { continued: true }).font('Helvetica-Bold').text(demande.email_responsable);
        doc.font('Helvetica').text(`Courriel facturation: `, { continued: true }).font('Helvetica-Bold').text(demande.email_facturation);
        doc.font('Helvetica').text(`Téléphone: `, { continued: true }).font('Helvetica-Bold').text(demande.phone);
        doc.moveDown(2);

        // Section: Conditions générales
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#FF7A00').text('CONDITIONS GÉNÉRALES');
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#FF7A00');
        doc.moveDown(0.5);
        doc.fillColor('black').font('Helvetica');

        doc.fontSize(9);
        doc.text('En signant ce formulaire, le client accepte les conditions suivantes:', { align: 'left' });
        doc.moveDown(0.5);
        doc.text('1. Les termes de paiement sont Net 30 jours à compter de la date de facturation.');
        doc.text('2. Tout compte en souffrance sera sujet à des frais d\'intérêt de 2% par mois.');
        doc.text('3. Les Jardins du Saguenay se réserve le droit de modifier les prix sans préavis.');
        doc.text('4. Les commandes minimales peuvent s\'appliquer selon le secteur d\'activité.');
        doc.text('5. Le client s\'engage à respecter les horaires de livraison établis.');
        doc.moveDown(2);

        // Section: Signature
        doc.fontSize(14).font('Helvetica-Bold').fillColor('#FF7A00').text('SIGNATURE ÉLECTRONIQUE');
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke('#FF7A00');
        doc.moveDown(1);
        doc.fillColor('black');

        // Signature box
        const signatureBoxY = doc.y;
        doc.rect(50, signatureBoxY, 250, 50).stroke();
        doc.fontSize(18).font('Helvetica-Oblique').text(demande.signature, 60, signatureBoxY + 15);
        doc.y = signatureBoxY + 60;

        doc.fontSize(10).font('Helvetica');
        doc.text(`Signé électroniquement le ${dateCreation}`, 50);
        doc.text('Le signataire confirme être autorisé(e) à engager l\'entreprise.');

        // Footer
        doc.moveDown(3);
        doc.fontSize(8).fillColor('gray');
        doc.text('Les Jardins du Saguenay - 418 542-1797 - lesjardinsdusaguenay.com', { align: 'center' });
        doc.text(`Document généré le ${new Date().toLocaleDateString('fr-CA')}`, { align: 'center' });

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
