// POST /api/quickbooks/sync-suppliers
// Pushes local suppliers to QuickBooks as Vendors

const { getQBClient, qbPromise, setIdMapping, getQboId, setLastSync } = require('../_lib/quickbooks-client');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { suppliers } = req.body;
  if (!suppliers || !Array.isArray(suppliers)) {
    return res.status(400).json({ error: 'Missing suppliers array' });
  }

  try {
    const qbo = await getQBClient();
    const results = { created: 0, updated: 0, errors: [] };

    for (const supplier of suppliers) {
      try {
        const qboId = await getQboId('supplier', supplier.id);

        // Parse contact name into first/last
        const nameParts = (supplier.contactName || '').split(' ');
        const givenName = nameParts[0] || '';
        const familyName = nameParts.slice(1).join(' ') || '';

        const vendorData = {
          DisplayName: (supplier.name || 'Unnamed Supplier').substring(0, 100),
        };

        if (givenName) vendorData.GivenName = givenName;
        if (familyName) vendorData.FamilyName = familyName;
        if (supplier.email) vendorData.PrimaryEmailAddr = { Address: supplier.email };
        if (supplier.phone) vendorData.PrimaryPhone = { FreeFormNumber: supplier.phone };
        if (supplier.website) vendorData.WebAddr = { URI: supplier.website };
        if (supplier.address) {
          vendorData.BillAddr = { Line1: supplier.address };
        }
        if (supplier.notes) vendorData.Notes = supplier.notes.substring(0, 4000);

        if (qboId) {
          vendorData.Id = qboId;
          vendorData.sparse = true;
          try {
            const existing = await qbPromise(qbo, 'getVendor', qboId);
            vendorData.SyncToken = existing.SyncToken;
            await qbPromise(qbo, 'updateVendor', vendorData);
            results.updated++;
          } catch (e) {
            delete vendorData.Id;
            delete vendorData.SyncToken;
            delete vendorData.sparse;
            const created = await qbPromise(qbo, 'createVendor', vendorData);
            await setIdMapping('supplier', supplier.id, created.Id);
            results.created++;
          }
        } else {
          const created = await qbPromise(qbo, 'createVendor', vendorData);
          await setIdMapping('supplier', supplier.id, created.Id);
          results.created++;
        }
      } catch (err) {
        results.errors.push({
          supplierId: supplier.id,
          name: supplier.name,
          error: err.Fault?.Error?.[0]?.Detail || err.message || 'Unknown error',
        });
      }
    }

    await setLastSync('suppliers');
    return res.status(200).json(results);
  } catch (error) {
    console.error('Sync suppliers error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};
