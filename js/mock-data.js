// ============================================================
//  Mock Data — D-Tools Approved Estimates
//
//  Test date range to use: 01 Jan 2026 → 31 Mar 2026
//
//  Expected results (5 records should appear):
//    Anderson Residence    $53,700.00   (2 records)
//    Baxter Commercial     $32,750.00   (1 record)
//    Heritage Hotel       $146,300.00   (2 records)
//    ─────────────────────────────────
//    Grand Total          $232,750.00
//
//  Noise records (5 records must NOT appear):
//    - Wrong status: Pending, Lost, Draft (within date range)
//    - Correct status but BEFORE range: Dec 2025
//    - Correct status but AFTER range:  Apr 2026
// ============================================================

// Raw records in D-Tools SI API shape.
// Field names prefixed with comments show the equivalent
// D-Tools Cloud field name where known to differ.
// NOTE: Exact API field names to be confirmed when live
//       credentials are available. See SETUP.md.

const MOCK_RAW_RECORDS = [

  // ── SHOULD APPEAR ─────────────────────────────────────────

  {
    // Record 1: Estimate, approved within range
    Id:                   "a1b2c3d4-0001-0000-0000-000000000001",
    Name:                 "Home Theater & Automation Package",
    ClientName:           "Anderson Residence",
    ProjectNumber:        "PRJ-2025-0041",
    Progress:             "Approved",          // SI field; Cloud uses "Status": "Accepted"
    ProgressChangedDate:  "2026-01-15T10:22:00Z",
    TotalPrice:           45200.00,
    IsChangeOrder:        false,
    ChangeOrderNumber:    null,
    _mockShouldAppear:    true,
    _mockReason:          "Approved within range"
  },

  {
    // Record 2: Change order on same client, approved within range
    Id:                   "a1b2c3d4-0002-0000-0000-000000000002",
    Name:                 "CO #1 — Additional Lighting Control",
    ClientName:           "Anderson Residence",
    ProjectNumber:        "PRJ-2025-0041",
    Progress:             "Approved",
    ProgressChangedDate:  "2026-02-03T14:05:00Z",
    TotalPrice:           8500.00,
    IsChangeOrder:        true,
    ChangeOrderNumber:    1,
    _mockShouldAppear:    true,
    _mockReason:          "CO approved within range"
  },

  {
    // Record 3: Single estimate, approved within range
    Id:                   "a1b2c3d4-0003-0000-0000-000000000003",
    Name:                 "Conference Room AV System",
    ClientName:           "Baxter Commercial",
    ProjectNumber:        "PRJ-2025-0058",
    Progress:             "Approved",
    ProgressChangedDate:  "2026-01-28T09:11:00Z",
    TotalPrice:           32750.00,
    IsChangeOrder:        false,
    ChangeOrderNumber:    null,
    _mockShouldAppear:    true,
    _mockReason:          "Approved within range"
  },

  {
    // Record 4: Large estimate, approved within range
    Id:                   "a1b2c3d4-0004-0000-0000-000000000004",
    Name:                 "Guest Room Entertainment Upgrade",
    ClientName:           "Heritage Hotel",
    ProjectNumber:        "PRJ-2025-0067",
    Progress:             "Approved",
    ProgressChangedDate:  "2026-03-12T11:48:00Z",
    TotalPrice:           127400.00,
    IsChangeOrder:        false,
    ChangeOrderNumber:    null,
    _mockShouldAppear:    true,
    _mockReason:          "Approved within range"
  },

  {
    // Record 5: Change order on large client, approved within range
    Id:                   "a1b2c3d4-0005-0000-0000-000000000005",
    Name:                 "CO #1 — Lobby Display Addition",
    ClientName:           "Heritage Hotel",
    ProjectNumber:        "PRJ-2025-0067",
    Progress:             "Approved",
    ProgressChangedDate:  "2026-03-22T16:30:00Z",
    TotalPrice:           18900.00,
    IsChangeOrder:        true,
    ChangeOrderNumber:    1,
    _mockShouldAppear:    true,
    _mockReason:          "CO approved within range"
  },

  // ── SHOULD NOT APPEAR — NOISE ──────────────────────────────

  {
    // Noise 1: Wrong status (Pending) — within date range
    Id:                   "noise-0001-0000-0000-000000000001",
    Name:                 "Network Infrastructure Upgrade",
    ClientName:           "Collins Office Park",
    ProjectNumber:        "PRJ-2025-0072",
    Progress:             "Pending",
    ProgressChangedDate:  "2026-01-20T08:00:00Z",
    TotalPrice:           22100.00,
    IsChangeOrder:        false,
    ChangeOrderNumber:    null,
    _mockShouldAppear:    false,
    _mockReason:          "Wrong status: Pending"
  },

  {
    // Noise 2: Correct status (Approved) but date is BEFORE the range
    Id:                   "noise-0002-0000-0000-000000000002",
    Name:                 "Smart Home Package",
    ClientName:           "Davis Residence",
    ProjectNumber:        "PRJ-2025-0019",
    Progress:             "Approved",
    ProgressChangedDate:  "2025-12-15T13:20:00Z",   // ← Dec 2025, before range
    TotalPrice:           38500.00,
    IsChangeOrder:        false,
    ChangeOrderNumber:    null,
    _mockShouldAppear:    false,
    _mockReason:          "Approved BEFORE date range (Dec 2025)"
  },

  {
    // Noise 3: Wrong status (Lost) — within date range
    Id:                   "noise-0003-0000-0000-000000000003",
    Name:                 "Background Music System",
    ClientName:           "Ellis Restaurant",
    ProjectNumber:        "PRJ-2025-0083",
    Progress:             "Lost",
    ProgressChangedDate:  "2026-02-10T10:15:00Z",
    TotalPrice:           15200.00,
    IsChangeOrder:        false,
    ChangeOrderNumber:    null,
    _mockShouldAppear:    false,
    _mockReason:          "Wrong status: Lost"
  },

  {
    // Noise 4: Correct status (Approved) but date is AFTER the range
    Id:                   "noise-0004-0000-0000-000000000004",
    Name:                 "Security Camera System",
    ClientName:           "Franklin Medical",
    ProjectNumber:        "PRJ-2026-0008",
    Progress:             "Approved",
    ProgressChangedDate:  "2026-04-05T09:00:00Z",   // ← Apr 2026, after range
    TotalPrice:           41800.00,
    IsChangeOrder:        false,
    ChangeOrderNumber:    null,
    _mockShouldAppear:    false,
    _mockReason:          "Approved AFTER date range (Apr 2026)"
  },

  {
    // Noise 5: Wrong status (Draft) — within date range
    Id:                   "noise-0005-0000-0000-000000000005",
    Name:                 "Outdoor AV & Landscape Audio",
    ClientName:           "Griffin Estate",
    ProjectNumber:        "PRJ-2026-0003",
    Progress:             "Draft",
    ProgressChangedDate:  "2026-03-01T11:00:00Z",
    TotalPrice:           29300.00,
    IsChangeOrder:        false,
    ChangeOrderNumber:    null,
    _mockShouldAppear:    false,
    _mockReason:          "Wrong status: Draft"
  }

];

// ── Mock API response wrapper (mirrors D-Tools SI paginated response) ──
function getMockSIResponse() {
  return {
    TotalCount: MOCK_RAW_RECORDS.length,
    PageNumber:  1,
    PageSize:    50,
    Items:       MOCK_RAW_RECORDS
  };
}

// ── Mock API response wrapper (mirrors D-Tools Cloud response shape) ──
// Cloud uses slightly different field names; the API client normalises both.
function getMockCloudResponse() {
  return {
    totalCount: MOCK_RAW_RECORDS.length,
    pageNumber:  1,
    pageSize:    50,
    items: MOCK_RAW_RECORDS.map(r => ({
      id:                r.Id,
      name:              r.Name,
      customerName:      r.ClientName,       // Cloud uses "customerName"
      projectNumber:     r.ProjectNumber,
      status:            r.Progress === "Approved" ? "Accepted" : r.Progress,
      statusChangedDate: r.ProgressChangedDate,
      totalAmount:       r.TotalPrice,       // Cloud uses "totalAmount"
      isChangeOrder:     r.IsChangeOrder,
      changeOrderNumber: r.ChangeOrderNumber,
      // meta fields for testing only — not present in real API
      _mockShouldAppear: r._mockShouldAppear,
      _mockReason:       r._mockReason
    }))
  };
}
