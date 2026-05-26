// ============================================================
//  D-Tools API Client
//
//  Supports:
//    - D-Tools SI   (on-premises / hosted)  → status: "Approved"
//    - D-Tools Cloud                         → status: "Accepted"
//    - Mock mode (no API key required)
//
//  All paths return a normalised array of estimate objects:
//  {
//    id, clientName, name, projectNumber, type,
//    changeOrderNumber, totalPrice, approvalDate
//  }
// ============================================================

class DToolsAPI {

  /**
   * @param {object} config
   * @param {string} config.apiType    'si' | 'cloud'
   * @param {string} config.apiKey     User's D-Tools API key
   * @param {string} config.workerUrl  Cloudflare Worker base URL
   * @param {boolean} config.useMock   true = return mock data
   */
  constructor(config) {
    this.apiType   = config.apiType   || 'si';
    this.apiKey    = config.apiKey    || '';
    this.workerUrl = config.workerUrl || '';
    this.useMock   = config.useMock   || false;
  }

  // ──────────────────────────────────────────────────────────
  //  PUBLIC API
  // ──────────────────────────────────────────────────────────

  /**
   * Fetch all estimates + change orders where the status
   * changed to Approved (SI) / Accepted (Cloud) within the
   * supplied date range.
   *
   * @param {string} startDate  ISO date string, e.g. "2026-01-01"
   * @param {string} endDate    ISO date string, e.g. "2026-03-31"
   * @returns {Promise<NormalisedRecord[]>}
   */
  async getApprovedEstimates(startDate, endDate) {
    if (this.useMock) {
      return this._mockGetApprovedEstimates(startDate, endDate);
    }
    if (this.apiType === 'si') {
      return this._siGetApprovedEstimates(startDate, endDate);
    }
    if (this.apiType === 'cloud') {
      return this._cloudGetApprovedEstimates(startDate, endDate);
    }
    throw new Error(`Unknown apiType: ${this.apiType}`);
  }

  // ──────────────────────────────────────────────────────────
  //  MOCK IMPLEMENTATION
  // ──────────────────────────────────────────────────────────

  _mockGetApprovedEstimates(startDate, endDate) {
    // Simulate a short async delay so the loading state is visible
    return new Promise(resolve => {
      setTimeout(() => {
        const start = new Date(startDate + 'T00:00:00Z');
        const end   = new Date(endDate   + 'T23:59:59Z');

        const response = getMockSIResponse();
        const items    = response.Items;

        const filtered = items.filter(item => {
          const isChangeOrder = item.IsChangeOrder || false;
          const dateStr       = isChangeOrder ? item.COAcceptedOn : item.ProgressChangedDate;
          if (!dateStr) return false;
          const changedDate = new Date(dateStr);
          return (
            item.Progress === 'Approved' &&
            changedDate >= start &&
            changedDate <= end
          );
        });

        resolve(filtered.map(item => this._normaliseSI(item)));
      }, 800);
    });
  }

  // ──────────────────────────────────────────────────────────
  //  D-TOOLS SI IMPLEMENTATION
  // ──────────────────────────────────────────────────────────

  async _siGetApprovedEstimates(startDate, endDate) {
    // Confirmed field names from D-Tools SI API (api.d-tools.com/si/doc):
    //   Progress            → project status ("Approved")
    //   ProgressChangedDate → date the Progress status last changed (estimates)
    //   COAcceptedOn        → date a change order was accepted (change orders)
    //   Client              → client name
    //   Price               → sell total (excluding tax)
    //   Number              → project number
    //   IsChangeOrder       → boolean — true when record is a change order
    //   CONumber            → change order number
    //   COName              → change order name
    //
    // The SI API returns ALL projects with Progress="Approved" in one paginated
    // list. Both estimates and change orders appear here (distinguished by
    // IsChangeOrder). We filter client-side by the appropriate date field.

    const start = new Date(startDate + 'T00:00:00Z');
    const end   = new Date(endDate   + 'T23:59:59Z');

    let allItems  = [];
    let pageNumber = 1;
    const pageSize = 200;

    // Paginate through all Approved projects + change orders
    while (true) {
      const response = await this._callWorker({
        apiType:  'si',
        endpoint: '/SI/Subscribe/Projects',
        method:   'GET',
        params: {
          progresses:      ['Approved'],
          includeArchived: false,
          includeDeleted:  false,
          pageNumber,
          pageSize
        }
      });

      const items = response.Items || [];
      allItems = allItems.concat(items);

      if (items.length < pageSize) break;
      pageNumber++;
    }

    // Filter by the appropriate date field:
    //   - Estimates:     ProgressChangedDate (when project moved to Approved)
    //   - Change orders: COAcceptedOn        (when CO was accepted)
    const filtered = allItems.filter(item => {
      const isChangeOrder = item.IsChangeOrder || false;
      const dateStr       = isChangeOrder ? item.COAcceptedOn : item.ProgressChangedDate;
      if (!dateStr) return false;
      const changedDate = new Date(dateStr);
      return changedDate >= start && changedDate <= end;
    });

    return filtered.map(item => this._normaliseSI(item));
  }

  // ──────────────────────────────────────────────────────────
  //  D-TOOLS CLOUD IMPLEMENTATION
  // ──────────────────────────────────────────────────────────

  async _cloudGetApprovedEstimates(startDate, endDate) {
    // Confirmed from D-Tools Cloud Swagger:
    // https://dtcloudapi.d-tools.cloud/apidocs/index.html
    //
    // Workflow (optimised for any volume of quotes):
    //   1. Fetch GetQuotes + GetOpportunities in PARALLEL (2 simultaneous calls)
    //   2. Filter quotes client-side: state === 'Accepted' AND acceptedDate in range
    //   3. Fetch GetQuote detail in BATCHES OF 10 (for opportunityId → clientName)
    //   4. Build normalised records using the pre-fetched opportunity map
    //
    // This means client names cost 1 call regardless of how many quotes there are,
    // and quote details are processed 10 at a time (not all at once).
    //
    // Note: D-Tools Cloud ChangeOrderLite has no acceptedDate field, so change
    // orders cannot be filtered by acceptance date via the Cloud API. Only Quotes
    // (estimates) are returned.

    const start = new Date(startDate + 'T00:00:00Z');
    const end   = new Date(endDate   + 'T23:59:59Z');

    // ── Step 1: Fetch all opportunities ─────────────────────
    // GetQuotes requires opportunityId — can't be called without one.
    // GetOpportunities returns OpportunityLite which includes clientName,
    // so no extra detail calls are needed.
    const allOpportunities = await this._callWorker({
      apiType:  'cloud',
      endpoint: '/api/v1/Opportunities/GetOpportunities',
      method:   'GET',
      params:   {}
    });

    const opps = Array.isArray(allOpportunities) ? allOpportunities : [];
    if (opps.length === 0) return [];

    // ── Step 2: Fetch quotes per opportunity in batches of 10 ─
    const BATCH_SIZE = 10;
    const allQuotes  = [];

    for (let i = 0; i < opps.length; i += BATCH_SIZE) {
      const batch = opps.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(opp =>
          this._callWorker({
            apiType:  'cloud',
            endpoint: '/api/v1/Quotes/GetQuotes',
            method:   'GET',
            params:   { opportunityId: opp.id }
          }).then(quotes =>
            (Array.isArray(quotes) ? quotes : []).map(q => ({
              ...q,
              _clientName: opp.clientName || ''
            }))
          ).catch(() => [])
        )
      );
      allQuotes.push(...batchResults.flat());
    }

    // ── Step 3: Filter — Accepted and within date range ──────
    const accepted = allQuotes.filter(q => {
      if (q.state !== 'Accepted' || !q.acceptedDate) return false;
      const d = new Date(q.acceptedDate);
      return d >= start && d <= end;
    });

    // ── Step 4: Build normalised records ─────────────────────
    return accepted.map(q => ({
      id:                q.id,
      clientName:        q._clientName   || '',
      name:              q.name          || '',
      projectNumber:     q.number        || '',
      type:              'estimate',
      changeOrderNumber: null,
      totalPrice:        parseFloat(q.price) || 0,
      approvalDate:      q.acceptedDate  || ''
    }));
  }

  // ──────────────────────────────────────────────────────────
  //  NORMALISE — SI
  //  Converts SI Subscribe/Projects response to common shape.
  //  Field names confirmed from api.d-tools.com/si/doc
  // ──────────────────────────────────────────────────────────

  _normaliseSI(item) {
    const isChangeOrder = item.IsChangeOrder || false;
    return {
      id:                item.Id,
      clientName:        item.Client      || item.ClientName || '',
      name:              isChangeOrder
                           ? (item.COName || item.Name || '')
                           : (item.Name   || ''),
      projectNumber:     item.Number      || item.ProjectNumber || '',
      type:              isChangeOrder ? 'change_order' : 'estimate',
      changeOrderNumber: item.CONumber    || item.ChangeOrderNumber || null,
      totalPrice:        parseFloat(item.Price || item.TotalPrice) || 0,
      approvalDate:      isChangeOrder
                           ? (item.COAcceptedOn        || '')
                           : (item.ProgressChangedDate || '')
    };
  }

  // ──────────────────────────────────────────────────────────
  //  CLOUDFLARE WORKER PROXY
  // ──────────────────────────────────────────────────────────

  async _callWorker(payload) {
    payload.apiKey = this.apiKey;

    const response = await fetch(this.workerUrl + '/proxy', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Worker error ${response.status}: ${text}`);
    }

    return response.json();
  }
}

// ──────────────────────────────────────────────────────────
//  RESULT GROUPING HELPERS
// ──────────────────────────────────────────────────────────

function groupByClient(records) {
  const map = {};

  records.forEach(r => {
    if (!map[r.clientName]) {
      map[r.clientName] = { clientName: r.clientName, records: [], subtotal: 0 };
    }
    map[r.clientName].records.push(r);
    map[r.clientName].subtotal += r.totalPrice;
  });

  Object.values(map).forEach(group => {
    group.records.sort((a, b) =>
      new Date(a.approvalDate) - new Date(b.approvalDate)
    );
  });

  return Object.values(map).sort((a, b) =>
    a.clientName.localeCompare(b.clientName)
  );
}

function grandTotal(groups) {
  return groups.reduce((sum, g) => sum + g.subtotal, 0);
}

// ──────────────────────────────────────────────────────────
//  FORMATTING HELPERS
// ──────────────────────────────────────────────────────────

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    style:    'currency',
    currency: 'USD',
    minimumFractionDigits: 2
  }).format(value);
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', {
    year:     'numeric',
    month:    'short',
    day:      'numeric',
    timeZone: 'UTC'
  });
}
