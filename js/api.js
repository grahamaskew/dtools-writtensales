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
    // coCache: { read(coIds[]) → Map<id,date>, write(id, date) → void }
    // Cloud-only — locks in the first-seen modifiedDate when state=Approved
    this.coCache   = config.coCache   || null;
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
    // D-Tools Cloud API — confirmed from Swagger at:
    // https://dtcloudapi.d-tools.cloud/apidocs/index.html
    //
    // In D-Tools Cloud, accepting a Quote creates a Project.
    // So Project.createdDate is the most reliable proxy for "estimate accepted date".
    // Change Orders live under Projects and have their own Approved state.
    //
    // D-Tools Cloud does not expose a dedicated CO approval date — only modifiedDate.
    // To prevent post-approval edits shifting a CO into the wrong month, we cache the
    // first-seen modifiedDate for each CO when state=Approved. Subsequent searches
    // use the cached date, ignoring any later modifications.
    //
    // Workflow:
    //   1. GET /api/v1/Projects/GetProjects (fromCreatedDate/toCreatedDate)
    //      → projects created in range = estimates accepted in range
    //
    //   2. GET /api/v1/Projects/GetProjects (fromModifiedDate/toModifiedDate)
    //      → projects active in range (may have COs approved in range)
    //
    //   3. GET /api/v1/ChangeOrders/GetChangeOrders?projectId={id}
    //      → fetch ALL approved COs, then resolve canonical date via cache

    const start    = new Date(startDate + 'T00:00:00Z');
    const end      = new Date(endDate   + 'T23:59:59Z');
    const isoStart = startDate + 'T00:00:00Z';
    const isoEnd   = endDate   + 'T23:59:59Z';

    // ── Step 1: Estimates — projects created in date range ───
    const newProjects = await this._callWorker({
      apiType:  'cloud',
      endpoint: '/api/v1/Projects/GetProjects',
      method:   'GET',
      params: {
        fromCreatedDate: isoStart,
        toCreatedDate:   isoEnd,
        includeArchived: false
      }
    });

    const estimateProjects = Array.isArray(newProjects)
      ? newProjects
      : (Array.isArray(newProjects?.projects) ? newProjects.projects : []);

    const estimateRecords = estimateProjects.map(p => ({
      id:                p.id,
      clientName:        p.clientName || '',
      name:              p.name       || '',
      projectNumber:     p.number     || '',
      type:              'estimate',
      changeOrderNumber: null,
      totalPrice:        parseFloat(p.price) || 0,
      approvalDate:      p.createdDate || ''
    }));

    // ── Step 2: ALL active projects ───────────────────────────
    // We cannot filter by modifiedDate here because D-Tools Cloud
    // does not reliably update a project's modifiedDate when one of
    // its change orders is approved. Fetching all non-archived projects
    // ensures no approved COs are missed; date filtering happens at
    // the CO level in Step 5 using the cached canonical approval date.
    const allProjects = await this._callWorker({
      apiType:  'cloud',
      endpoint: '/api/v1/Projects/GetProjects',
      method:   'GET',
      params: {
        includeArchived: false
      }
    });

    const coProjects = Array.isArray(allProjects)
      ? allProjects
      : (Array.isArray(allProjects?.projects) ? allProjects.projects : []);

    // ── Step 3: Fetch ALL approved COs (no date filter yet) ──
    // Collect first, then resolve canonical dates via cache before filtering.
    const BATCH_SIZE  = 10;
    const allApproved = []; // [{ co, project }]

    for (let i = 0; i < coProjects.length; i += BATCH_SIZE) {
      const batch = coProjects.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(project =>
          this._callWorker({
            apiType:  'cloud',
            endpoint: '/api/v1/ChangeOrders/GetChangeOrders',
            method:   'GET',
            params:   { projectId: project.id }
          }).then(cos => {
            const coList = Array.isArray(cos) ? cos : [];
            return coList
              .filter(co => co.state === 'Approved')
              .map(co => ({ co, project }));
          }).catch(() => [])
        )
      );
      allApproved.push(...batchResults.flat());
    }

    // ── Step 4: Bulk-read CO approval date cache ──────────────
    // Returns a Map<coId, canonicalApprovalDate> for any COs
    // whose approval date was already locked in by a prior search.
    let cacheMap = new Map();
    if (this.coCache && allApproved.length > 0) {
      const coIds = allApproved.map(({ co }) => co.id);
      cacheMap = await this.coCache.read(coIds);
    }

    // ── Step 5: Resolve canonical date, filter, collect writes ─
    const newCacheEntries = new Map();
    const coRecords       = [];

    for (const { co, project } of allApproved) {
      let approvalDate;

      if (cacheMap.has(co.id)) {
        // Previously seen — use the locked-in approval date
        approvalDate = cacheMap.get(co.id);
      } else {
        // First time seeing this CO as Approved — lock in modifiedDate now
        approvalDate = co.modifiedDate || '';
        if (approvalDate) newCacheEntries.set(co.id, approvalDate);
      }

      // Filter by canonical date
      if (!approvalDate) continue;
      const d = new Date(approvalDate);
      if (d < start || d > end) continue;

      coRecords.push({
        id:                co.id,
        clientName:        project.clientName || '',
        name:              co.name            || '',
        projectNumber:     project.number     || '',
        type:              'change_order',
        changeOrderNumber: co.number          || null,
        totalPrice:        parseFloat(co.price) || 0,
        approvalDate
      });
    }

    // ── Step 6: Write new cache entries to Firestore ──────────
    if (this.coCache && newCacheEntries.size > 0) {
      await Promise.all(
        Array.from(newCacheEntries.entries()).map(([id, date]) =>
          this.coCache.write(id, date)
        )
      );
    }

    // ── Step 7: Combine estimates + COs, deduplicate by id ───
    const seen = new Set();
    return [...estimateRecords, ...coRecords].filter(r => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
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
