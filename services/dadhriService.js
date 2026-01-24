// =====================================================
// Service d'intégration API Dadhri.NET
// =====================================================

const DADHRI_BASE_URL = 'https://online.dadhri.net/api';

// =====================================================
// Génération du code client unique
// =====================================================

function generateClientCode(demande) {
    // Format: CLI-{ANNÉE}-{ID demande padded}
    const year = new Date().getFullYear();
    const paddedId = String(demande.id).padStart(4, '0');
    return `CLI-${year}-${paddedId}`;
}

// =====================================================
// Construction du champ Notes structuré
// =====================================================

function buildNotesField(demande) {
    const parts = [];

    if (demande.owner_name) {
        parts.push(`Propriétaire: ${demande.owner_name}`);
    }

    if (demande.sector) {
        const sectorLabels = {
            'restaurant': 'Restaurant',
            'epicerie': 'Épicerie',
            'hotel': 'Hôtel',
            'institution': 'Institution',
            'autre': 'Autre'
        };
        parts.push(`Secteur: ${sectorLabels[demande.sector] || demande.sector}`);
    }

    if (demande.annual_purchase) {
        parts.push(`Volume annuel: ${demande.annual_purchase}`);
    }

    if (demande.email_facturation && demande.email_facturation !== demande.email_responsable) {
        parts.push(`Email facturation: ${demande.email_facturation}`);
    }

    if (demande.promo_accepted === 'yes') {
        parts.push(`Carte Promo: Oui (min. ${demande.promo_min_order})`);
    }

    // Ajouter la date d'approbation
    parts.push(`Approuvé le: ${new Date().toLocaleDateString('fr-CA')}`);

    return parts.join(' | ');
}

// =====================================================
// Mapping des données du formulaire vers API Dadhri
// =====================================================

function mapDemandeToClient(demande, clientCode) {
    return {
        Code: clientCode,
        Name: demande.company_name,
        Address: demande.address,
        City: demande.city,
        Province: 'QC', // Toujours Québec
        PostalCode: demande.postal_code,
        Phone: demande.phone,
        Email: demande.email_responsable,
        ContactName: demande.contact_name || demande.owner_name,
        Terms: 'Net 30', // Termes par défaut
        CreditLimit: 5000.00, // Limite initiale par défaut
        Notes: buildNotesField(demande)
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

    try {
        const response = await fetch(`${DADHRI_BASE_URL}/clients?APIKey=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(clientData)
        });

        const responseData = await response.json().catch(() => null);

        if (response.ok) {
            console.log(`Client créé dans Dadhri: ${clientCode} - ${demande.company_name}`);
            return {
                success: true,
                clientCode: clientCode,
                dadhriId: responseData?.Id,
                data: responseData
            };
        }

        // Gestion des erreurs spécifiques
        if (response.status === 409) {
            // Code client déjà existant - générer un nouveau code avec timestamp
            const newCode = `CLI-${Date.now()}`;
            console.log(`Code ${clientCode} existe déjà, réessai avec ${newCode}`);

            const retryData = { ...clientData, Code: newCode };
            const retryResponse = await fetch(`${DADHRI_BASE_URL}/clients?APIKey=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(retryData)
            });

            if (retryResponse.ok) {
                const retryResponseData = await retryResponse.json().catch(() => null);
                console.log(`Client créé dans Dadhri avec code alternatif: ${newCode}`);
                return {
                    success: true,
                    clientCode: newCode,
                    dadhriId: retryResponseData?.Id,
                    data: retryResponseData
                };
            }
        }

        if (response.status === 401) {
            console.error('API Key Dadhri invalide');
            return {
                success: false,
                error: 'API Key Dadhri invalide ou expirée'
            };
        }

        console.error(`Erreur création client Dadhri: ${response.status}`, responseData);
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
        // Tenter de lister les clients pour vérifier la connexion
        const response = await fetch(`${DADHRI_BASE_URL}/clients?APIKey=${apiKey}&$top=1`, {
            method: 'GET'
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
