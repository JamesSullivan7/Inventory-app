// GET /api/quickbooks/fetch-report
// Fetches Profit & Loss report from QuickBooks

const { ensureValidToken } = require('../_lib/quickbooks-client');

const QBO_ENV = process.env.QUICKBOOKS_ENV || 'sandbox';
const BASE_URL = QBO_ENV === 'production'
  ? 'https://quickbooks.api.intuit.com'
  : 'https://sandbox-quickbooks.api.intuit.com';

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { access_token, realm_id } = await ensureValidToken();

    // Date range: default to current month, or use query params
    const now = new Date();
    const startDate = req.query.start_date || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endDate = req.query.end_date || now.toISOString().split('T')[0];

    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
    });

    const url = `${BASE_URL}/v3/company/${realm_id}/reports/ProfitAndLoss?${params}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`QBO API error: ${response.status} ${err}`);
    }

    const report = await response.json();

    // Parse the QBO report format into something simpler
    const parsed = parseQBOReport(report);

    return res.status(200).json({
      report: parsed,
      period: { start_date: startDate, end_date: endDate },
      raw: report, // include raw for debugging
    });
  } catch (error) {
    console.error('Fetch report error:', error.message);
    return res.status(500).json({ error: error.message });
  }
};

function parseQBOReport(report) {
  const result = {
    title: report.Header?.ReportName || 'Profit and Loss',
    period: report.Header?.StartPeriod + ' to ' + report.Header?.EndPeriod,
    income: { total: 0, items: [] },
    cogs: { total: 0, items: [] },
    expenses: { total: 0, items: [] },
    grossProfit: 0,
    netIncome: 0,
  };

  if (!report.Rows?.Row) return result;

  for (const section of report.Rows.Row) {
    const sectionName = section.group || '';
    const summary = section.Summary?.ColData?.[1]?.value || '0';

    if (sectionName === 'Income') {
      result.income.total = parseFloat(summary) || 0;
      if (section.Rows?.Row) {
        result.income.items = section.Rows.Row
          .filter(r => r.ColData)
          .map(r => ({
            name: r.ColData[0]?.value || '',
            amount: parseFloat(r.ColData[1]?.value) || 0,
          }));
      }
    } else if (sectionName === 'COGS') {
      result.cogs.total = parseFloat(summary) || 0;
      if (section.Rows?.Row) {
        result.cogs.items = section.Rows.Row
          .filter(r => r.ColData)
          .map(r => ({
            name: r.ColData[0]?.value || '',
            amount: parseFloat(r.ColData[1]?.value) || 0,
          }));
      }
    } else if (sectionName === 'Expenses') {
      result.expenses.total = parseFloat(summary) || 0;
      if (section.Rows?.Row) {
        result.expenses.items = section.Rows.Row
          .filter(r => r.ColData)
          .map(r => ({
            name: r.ColData[0]?.value || '',
            amount: parseFloat(r.ColData[1]?.value) || 0,
          }));
      }
    } else if (sectionName === 'GrossProfit') {
      result.grossProfit = parseFloat(summary) || 0;
    } else if (sectionName === 'NetIncome') {
      result.netIncome = parseFloat(summary) || 0;
    }
  }

  return result;
}
