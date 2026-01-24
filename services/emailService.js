const nodemailer = require('nodemailer');

// =====================================================
// Configuration du transporteur SMTP
// =====================================================

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true pour 465, false pour autres ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// =====================================================
// Template Email de Confirmation d'Approbation
// =====================================================

function generateApprovalEmailHTML(demande) {
    const currentYear = new Date().getFullYear();

    return `
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bienvenue chez Les Jardins du Saguenay</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
    <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tr>
            <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="width: 600px; max-width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">

                    <!-- Header avec logo -->
                    <tr>
                        <td style="background: linear-gradient(135deg, #2d5016 0%, #4a7c23 100%); padding: 40px 40px 30px; border-radius: 12px 12px 0 0; text-align: center;">
                            <img src="https://lesjardinsdusaguenay.com/logo.png" alt="Les Jardins du Saguenay" style="max-width: 200px; height: auto; margin-bottom: 20px;" onerror="this.style.display='none'">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">
                                Bienvenue dans la famille!
                            </h1>
                        </td>
                    </tr>

                    <!-- Icône de succès -->
                    <tr>
                        <td align="center" style="padding: 30px 40px 20px;">
                            <div style="width: 80px; height: 80px; background-color: #e8f5e9; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                                <span style="font-size: 40px;">&#10004;</span>
                            </div>
                        </td>
                    </tr>

                    <!-- Message principal -->
                    <tr>
                        <td style="padding: 0 40px 30px;">
                            <h2 style="color: #2d5016; margin: 0 0 20px; font-size: 22px; text-align: center;">
                                Votre compte a été approuvé!
                            </h2>
                            <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 20px; text-align: center;">
                                Bonjour <strong>${demande.contact_name || demande.owner_name}</strong>,
                            </p>
                            <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                                Nous avons le plaisir de vous informer que votre demande d'ouverture de compte pour
                                <strong>${demande.company_name}</strong> a été approuvée.
                            </p>
                            <p style="color: #555555; font-size: 16px; line-height: 1.6; margin: 0;">
                                Vous pouvez maintenant passer vos commandes et profiter de nos produits frais de qualité supérieure.
                            </p>
                        </td>
                    </tr>

                    <!-- Récapitulatif du compte -->
                    <tr>
                        <td style="padding: 0 40px 30px;">
                            <div style="background-color: #f8f9fa; border-radius: 8px; padding: 25px; border-left: 4px solid #4a7c23;">
                                <h3 style="color: #2d5016; margin: 0 0 15px; font-size: 18px;">
                                    Récapitulatif de votre compte
                                </h3>
                                <table style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="color: #777777; padding: 8px 0; font-size: 14px;">Entreprise:</td>
                                        <td style="color: #333333; padding: 8px 0; font-size: 14px; font-weight: 600;">${demande.company_name}</td>
                                    </tr>
                                    <tr>
                                        <td style="color: #777777; padding: 8px 0; font-size: 14px;">Secteur:</td>
                                        <td style="color: #333333; padding: 8px 0; font-size: 14px;">${formatSector(demande.sector)}</td>
                                    </tr>
                                    <tr>
                                        <td style="color: #777777; padding: 8px 0; font-size: 14px;">Adresse:</td>
                                        <td style="color: #333333; padding: 8px 0; font-size: 14px;">${demande.address}, ${demande.city}, ${demande.postal_code}</td>
                                    </tr>
                                    <tr>
                                        <td style="color: #777777; padding: 8px 0; font-size: 14px;">Téléphone:</td>
                                        <td style="color: #333333; padding: 8px 0; font-size: 14px;">${demande.phone}</td>
                                    </tr>
                                    ${demande.promo_accepted === 'yes' ? `
                                    <tr>
                                        <td colspan="2" style="padding-top: 15px;">
                                            <div style="background-color: #fff3cd; border-radius: 6px; padding: 12px; border: 1px solid #ffc107;">
                                                <span style="color: #856404; font-size: 14px;">
                                                    <strong>&#127873; Programme Carte Promo activé!</strong><br>
                                                    Commande minimum: ${demande.promo_min_order} pour obtenir 2% de rabais
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                    ` : ''}
                                </table>
                            </div>
                        </td>
                    </tr>

                    <!-- Prochaines étapes -->
                    <tr>
                        <td style="padding: 0 40px 30px;">
                            <h3 style="color: #2d5016; margin: 0 0 15px; font-size: 18px;">
                                Prochaines étapes
                            </h3>
                            <table style="width: 100%; border-collapse: collapse;">
                                <tr>
                                    <td style="padding: 10px 0; vertical-align: top; width: 40px;">
                                        <div style="width: 28px; height: 28px; background-color: #4a7c23; border-radius: 50%; color: white; text-align: center; line-height: 28px; font-size: 14px; font-weight: bold;">1</div>
                                    </td>
                                    <td style="padding: 10px 0; color: #555555; font-size: 15px;">
                                        Un représentant vous contactera sous peu pour discuter de vos besoins
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 0; vertical-align: top;">
                                        <div style="width: 28px; height: 28px; background-color: #4a7c23; border-radius: 50%; color: white; text-align: center; line-height: 28px; font-size: 14px; font-weight: bold;">2</div>
                                    </td>
                                    <td style="padding: 10px 0; color: #555555; font-size: 15px;">
                                        Vous recevrez votre première liste de prix et catalogue de produits
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px 0; vertical-align: top;">
                                        <div style="width: 28px; height: 28px; background-color: #4a7c23; border-radius: 50%; color: white; text-align: center; line-height: 28px; font-size: 14px; font-weight: bold;">3</div>
                                    </td>
                                    <td style="padding: 10px 0; color: #555555; font-size: 15px;">
                                        Passez votre première commande et profitez de nos produits frais!
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Contact -->
                    <tr>
                        <td style="padding: 0 40px 30px;">
                            <div style="background-color: #e8f5e9; border-radius: 8px; padding: 20px; text-align: center;">
                                <p style="color: #2d5016; margin: 0 0 10px; font-size: 15px;">
                                    <strong>Des questions?</strong>
                                </p>
                                <p style="color: #555555; margin: 0; font-size: 14px;">
                                    N'hésitez pas à nous contacter par téléphone ou courriel.<br>
                                    Notre équipe est là pour vous accompagner!
                                </p>
                            </div>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #2d5016; padding: 30px 40px; border-radius: 0 0 12px 12px; text-align: center;">
                            <p style="color: #ffffff; margin: 0 0 10px; font-size: 16px; font-weight: 600;">
                                Les Jardins du Saguenay
                            </p>
                            <p style="color: #a5d6a7; margin: 0 0 15px; font-size: 14px;">
                                Fruits et légumes frais depuis 1985
                            </p>
                            <p style="color: #a5d6a7; margin: 0; font-size: 12px;">
                                &copy; ${currentYear} Les Jardins du Saguenay. Tous droits réservés.
                            </p>
                        </td>
                    </tr>

                </table>
            </td>
        </tr>
    </table>
</body>
</html>
    `;
}

// =====================================================
// Fonctions utilitaires
// =====================================================

function formatSector(sector) {
    const sectors = {
        'restaurant': 'Restaurant',
        'epicerie': 'Épicerie',
        'hotel': 'Hôtel',
        'institution': 'Institution',
        'autre': 'Autre'
    };
    return sectors[sector] || sector;
}

// =====================================================
// Fonction d'envoi d'email d'approbation
// =====================================================

async function sendApprovalEmail(demande) {
    // Vérifier que les credentials SMTP sont configurés
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
        console.warn('Configuration SMTP manquante - Email non envoyé');
        return { success: false, error: 'Configuration SMTP manquante' };
    }

    try {
        const mailOptions = {
            from: `"Les Jardins du Saguenay" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
            to: demande.email_responsable,
            cc: demande.email_facturation !== demande.email_responsable ? demande.email_facturation : undefined,
            subject: `Bienvenue ${demande.company_name} - Votre compte est approuvé!`,
            html: generateApprovalEmailHTML(demande)
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`Email de confirmation envoyé à ${demande.email_responsable}: ${info.messageId}`);

        return { success: true, messageId: info.messageId };
    } catch (error) {
        console.error('Erreur envoi email:', error);
        return { success: false, error: error.message };
    }
}

// =====================================================
// Vérifier la connexion SMTP
// =====================================================

async function verifySmtpConnection() {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
        return { connected: false, error: 'Configuration SMTP manquante' };
    }

    try {
        await transporter.verify();
        console.log('Connexion SMTP vérifiée avec succès');
        return { connected: true };
    } catch (error) {
        console.error('Erreur connexion SMTP:', error);
        return { connected: false, error: error.message };
    }
}

module.exports = {
    sendApprovalEmail,
    verifySmtpConnection
};
