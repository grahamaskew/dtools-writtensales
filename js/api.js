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

        // Get the appropriate raw mock data for the configured API type
        const response = this.apiType === 'cloud'
          ? getMockCloudResponse()
          : getMockSIResponse();

        const items = this.apiType === 'cloud'
          ? response.items
          : response.Items;

        const filtered = items.filter(item => {
          const approvedStatus = this.apiType === 'cloud' ? 'Accepted' : 'Approved';
          const dateField      = this.apiType === 'cloud'
            ? item.statusChangedDate
            : item.ProgressChangedDate;

          const status       = this.apiType === 'cloud' ? item.status : item.Progress;
          const changedDate  = new Date(dateField);

          return (
            status === approvedStatus &&
            changedDate >= start &&
            changedDate <= end
          );
        });

        resolve(filtered.map(item => this._normalise(item)));
      }, 800); // simulated network delay
    });
  }

  // ──────────────────────────────────────────────────────────
  //  D-TOOLS SI IMPLEMENTATION
  // ──────────────────────────────────────────────────────────

  async _siGetApprovedEstimates(startDate, endDate) {
    // SI API returns ALL projects with status "Approved".
    // We filter by ProgressChangedDate client-side because the
    // SI API does not support date-range filtering on status change.
    //
    // NOTE: Exact field names to be verified against live API.
    // Key assumed field names:
    //   Progress            → project status
    //   ProgressChangedDate → date status last changed
    //   TotalPrice          → sell total
    //   ClientName          → client name
    //   IsChangeOrder       → boolean
    //   ChangeOrderNumber   → CO number or null

    const start = new Date(startDate + 'T00:00:00Z');
    const end   = new Date(endDate   + 'T23:59:59Z');

    let allItems = [];
    let pageNumber = 1;
    const pageSize = 200;

    // Paginate through all Approved projects
    while (true) {
      const response = await this._callWorker({
        apiType:  'si',
        endpoint: '/SI/Subscribe/Projects',
        method:   'GET',
        params: {
          progresses: ['Approved'],
          includeArchived: false,
          includeDeleted:  false,
          pageNumber,
          pageSize
        }
      });

      const items = response.Items || [];
      allItems = allItems.concat(items);

      // Stop if we've received all pages
      if (items.length < pageSize) break;
      pageNumber++;
    }

    // Filter by status change date falling within the requested range
    const filtered = allItems.filter(item => {
      const changedDate = new Date(item.ProgressChangedDate);
      return changedDate >= start && changedDate <= end;
    });

    return filtered.map(item => this._normalise(item));
  }

  // ──────────────────────────────────────────────────────────
  //  D-TOOLS CLOUD IMPLEMENTATION
  // ──────────────────────────────────────────────────────────

  async _cloudGetApprovedEstimates(startDate, endDate) {
    // Cloud uses "Accepted" status and slightly different field names.
    // NOTE: Cloud API base URL and exact endpoint paths to be confirmed.
    // Reference: https://docs.d-tools.cloud/en/articles/8756121-api-endpoints

    const start = new Date(startDate + 'T00:00:00Z');
    const end   = new Date(endDate   + 'T23:59:59Z');

    let allItems = [];
    let pageNumber = 1;
    const pageSize = 200;

    while (true) {
      const response = await this._callWorker({
        apiType:  'cloud',
        endpoint: '/projects',            // ← Confirm exact path from Cloud API docs
        method:   'GET',
        params: {
          status:     'Accepted',
          pageNumber,
          pageSize
        }
      });

      const items = response.items || [];
      allItems = allItems.concat(items);

      if (items.length < pageSize) break;
      pageNumber++;
    }

    const filtered = allItems.filter(item => {
      const changedDate = new Date(item.statusChangedDate);
      return changedDate >= start && changedDate <= end;
    });

    return filtered.map(item => this._normalise(item));
  }

  // ──────────────────────────────────────────────────────────
  //  NORMALISE (converts either API shape to a common object)
  // ──────────────────────────────────────────────────────────

  _normalise(item) {
    if (this.apiType === 'cloud') {
      return {
        id:                item.id,
        clientName:        item.customerName || item.clientName || '',
        name:              item.name || '',
        projectNumber:     item.projectNumber || '',
        type:              item.isChangeOrder ? 'change_order' : 'estimate',
        changeOrderNumber: item.changeOrderNumber || null,
        totalPrice:        parseFloat(item.totalAmount) || 0,
        approvalDate:      item.statusChangedDate || ''
      };
    } else {
      // SI (also used for mock SI data)
      return {
        id:                item.Id,
        clientName:        item.ClientName || '',
        name:              item.Name || '',
        projectNumber:     item.ProjectNumber || '',
        type:              item.IsChangeOrder ? 'change_order' : 'estimate',
        changeOrderNumber: item.ChangeOrderNumber || null,
        totalPrice:        parseFloat(item.TotalPrice) || 0,
        approvalDate:      item.ProgressChangedDate || ''
      };
    }
  }

  // ──────────────────────────────────────────────────────────
  //  CLOUDFLARE WORKER PROXY
  // ──────────────────────────────────────────────────────────

  async _callWorker(payload) {
    // Passes the request to the Cloudflare Worker, which adds
    // the correct auth header and forwards to D-Tools.
    payload.apiKey = this.apiKey;

    const response = await fetch(this.workerUrl + '/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
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

/**
 * Groups an array of normalised records by clientName (A–Z),
 * then sorts each client's records by approvalDate ascending.
 *
 * Returns:
 * [
 *   {
 *     clientName: "Anderson Residence",
 *     records: [ ...NormalisedRecord ],
 *     subtotal: 53700
 *   },
 *   ...
 * ]
 */
function groupByClient(records) {
  const map = {};

  records.forEach(r => {
    if (!map[r.clientName]) {
      map[r.clientName] = { clientName: r.clientName, records: [], subtotal: 0 };
    }
    map[r.clientName].records.push(r);
    map[r.clientName].subtotal += r.totalPrice;
  });

  // Sort each client's records by approval date ascending
  Object.values(map).forEach(group => {
    group.records.sort((a, b) =>
      new Date(a.approvalDate) - new Date(b.approvalDate)
    );
  });

  // Sort clients alphabetically
  return Object.values(map).sort((a, b) =>
    a.clientName.localeCompare(b.clientName)
  );
}

/**
 * Calculates the grand total across all groups.
 * @param {Array} groups  Result of groupByClient()
 * @returns {number}
 */
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
    year:  'numeric',
    month: 'short',
    day:   'numeric',
    timeZone: 'UTC'
  });
}
