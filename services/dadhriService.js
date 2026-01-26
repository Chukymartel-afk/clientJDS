// =====================================================
// Service d'intégration API Dadhri.NET
// =====================================================

// URL de base Dadhri
const DADHRI_BASE_URL = process.env.DADHRI_API_URL || 'https://jds-demo.dadhri.net:1443/dadhri.web/rest';

// =====================================================
// Génération du code client unique (max 10 caractères)
// =====================================================

function generateClientCode(demande) {
    // Le code client = les 7 derniers chiffres du numéro de téléphone
    const phoneDigits = (demande.phone || '').replace(/\D/g, ''); // Enlever tout sauf les chiffres
    const clientCode = phoneDigits.slice(-7); // Prendre les 7 derniers chiffres

    // Si pas assez de chiffres, utiliser l'ID comme fallback
    if (clientCode.length < 7) {
        return String(demande.id).padStart(7, '0');
    }

    return clientCode;
}

// =====================================================
// Mapping des données du formulaire vers API Dadhri
// =====================================================

function mapDemandeToClient(demande, clientCode) {
    // Tronquer le nom à 40 caractères max
    const clientName = (demande.company_name || '').substring(0, 40);

    // Tronquer l'adresse à 40 caractères max
    const addressLine1 = (demande.address || '').substring(0, 40);

    // Contact name dans line2 si différent du propriétaire
    let addressLine2 = '';
    if (demande.contact_name && demande.contact_name !== demande.owner_name) {
        addressLine2 = `Contact: ${demande.contact_name}`.substring(0, 40);
    }

    // Formater le téléphone (enlever les caractères non-numériques sauf +)
    const phoneNumber = (demande.phone || '').replace(/[^\d+]/g, '').substring(0, 20);

    return {
        id: clientCode,
        name: clientName,
        phone: phoneNumber,
        email: (demande.email_responsable || '').substring(0, 210),
        language: 'F',
        address: {
            line1: addressLine1,
            line2: addressLine2,
            city: (demande.city || '').substring(0, 40),
            province: 'QC',
            postal_code: (demande.postal_code || '').substring(0, 10),
            country: 'CA'
        }
    };
}

// =====================================================
// Création du client dans Dadhri
// =====================================================

async function createDadhriClient(demande) {
    const apiKey = process.env.DADHRI_API_KEY;

    // Vérifier que l'API Key est configurée
    if (!apiKey) {
        console.warn('DADHRI_API_KEY non configurée - Client non créé dans Dadhri');
        return {
            success: false,
            error: 'API Key Dadhri non configurée'
        };
    }

    const clientCode = generateClientCode(demande);
    const clientData = mapDemandeToClient(demande, clientCode);

    const clientEndpoint = `${DADHRI_BASE_URL}/client`;

    console.log(`Création client Dadhri: ${clientEndpoint}`);
    console.log(`Données client:`, JSON.stringify(clientData, null, 2));

    try {
        const response = await fetch(clientEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api_key': apiKey
            },
            body: JSON.stringify(clientData)
        });

        const responseData = await response.json().catch(() => null);

        console.log(`Réponse Dadhri (${response.status}):`, responseData);

        if (response.ok && responseData?.success) {
            console.log(`Client créé dans Dadhri: ${clientCode} - ${demande.company_name}`);
            return {
                success: true,
                clientCode: clientCode,
                data: responseData
            };
        }

        // Gestion des erreurs spécifiques
        if (responseData?.errorcode === 'exists') {
            // Code client déjà existant - générer un nouveau code avec timestamp
            const newCode = `JDS${Date.now().toString().slice(-7)}`;
            console.log(`Code ${clientCode} existe déjà, réessai avec ${newCode}`);

            const retryData = { ...clientData, id: newCode };
            const retryResponse = await fetch(clientEndpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'api_key': apiKey
                },
                body: JSON.stringify(retryData)
            });

            const retryResponseData = await retryResponse.json().catch(() => null);

            if (retryResponse.ok && retryResponseData?.success) {
                console.log(`Client créé dans Dadhri avec code alternatif: ${newCode}`);
                return {
                    success: true,
                    clientCode: newCode,
                    data: retryResponseData
                };
            }
        }

        if (responseData?.errorcode === 'invalidapikey') {
            console.error('API Key Dadhri invalide');
            return {
                success: false,
                error: 'API Key Dadhri invalide ou expirée'
            };
        }

        console.error(`Erreur création client Dadhri:`, responseData);
        return {
            success: false,
            error: responseData?.message || `Erreur ${response.status}`
        };

    } catch (error) {
        console.error('Erreur connexion API Dadhri:', error);
        return {
            success: false,
            error: `Erreur de connexion: ${error.message}`
        };
    }
}

// =====================================================
// Vérifier la connexion à l'API Dadhri
// =====================================================

async function verifyDadhriConnection() {
    const apiKey = process.env.DADHRI_API_KEY;

    if (!apiKey) {
        return { connected: false, error: 'API Key non configurée' };
    }

    try {
        // Tenter un ping pour vérifier la connexion
        const response = await fetch(`${DADHRI_BASE_URL}/ping`, {
            method: 'GET',
            headers: {
                'api_key': apiKey
            }
        });

        if (response.ok) {
            console.log('Connexion API Dadhri vérifiée avec succès');
            return { connected: true };
        }

        if (response.status === 401) {
            return { connected: false, error: 'API Key invalide' };
        }

        return { connected: false, error: `Erreur ${response.status}` };

    } catch (error) {
        console.error('Erreur vérification Dadhri:', error);
        return { connected: false, error: error.message };
    }
}

module.exports = {
    createDadhriClient,
    verifyDadhriConnection,
    generateClientCode
};
