import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import PharmacyLocationPicker from './PharmacyLocationPicker.jsx';
import { searchAddressWithFallback } from './geocoding.js';

const blank = { medicine: '', generic: '', quantity: 0, price: '' };
const LOW_STOCK_THRESHOLD = 10;

const parseCoordinates = loc => {
  const coords = loc?.coordinates;
  if (
    Array.isArray(coords) &&
    coords.length === 2 &&
    Number.isFinite(Number(coords[0])) &&
    Number.isFinite(Number(coords[1]))
  ) {
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }
  return null;
};

const getActivityActionMeta = (actionType) => {
  switch (actionType) {
    case 'medicine_added':
      return { label: 'Medicine Added', badgeClass: 'act-badge-emerald', icon: '➕' };
    case 'stock_increased':
      return { label: 'Stock Increased', badgeClass: 'act-badge-emerald', icon: '📈' };
    case 'stock_decreased':
      return { label: 'Stock Decreased', badgeClass: 'act-badge-amber', icon: '📉' };
    case 'medicine_updated':
      return { label: 'Medicine Updated', badgeClass: 'act-badge-blue', icon: '✏️' };
    case 'medicine_removed':
      return { label: 'Medicine Deleted', badgeClass: 'act-badge-rose', icon: '🗑️' };
    case 'reservation_confirmed':
      return { label: 'Reservation Confirmed', badgeClass: 'act-badge-emerald', icon: '✅' };
    case 'reservation_ready':
      return { label: 'Reservation Ready', badgeClass: 'act-badge-blue', icon: '📦' };
    case 'reservation_collected':
      return { label: 'Reservation Collected', badgeClass: 'act-badge-purple', icon: '🤝' };
    case 'reservation_cancelled':
      return { label: 'Reservation Cancelled', badgeClass: 'act-badge-rose', icon: '❌' };
    case 'transfer_requested':
      return { label: 'Transfer Requested', badgeClass: 'act-badge-amber', icon: '🔄' };
    case 'transfer_approved':
      return { label: 'Transfer Approved', badgeClass: 'act-badge-emerald', icon: '✓' };
    case 'transfer_rejected':
      return { label: 'Transfer Rejected', badgeClass: 'act-badge-rose', icon: '✕' };
    case 'transfer_cancelled':
      return { label: 'Transfer Cancelled', badgeClass: 'act-badge-gray', icon: '🚫' };
    case 'transfer_dispatched':
      return { label: 'Transfer Dispatched', badgeClass: 'act-badge-indigo', icon: '🚚' };
    case 'transfer_received':
      return { label: 'Transfer Received', badgeClass: 'act-badge-teal', icon: '📥' };
    default:
      return {
        label: (actionType || 'Action').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        badgeClass: 'act-badge-blue',
        icon: '📝'
      };
  }
};

const formatActivityTime = (dateString) => {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }) + ' at ' + d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

export default function Dashboard({ auth, socket, onLogout }) {
  const isOwner = auth.role === 'pharmacy';
  const isStaff = auth.role === 'staff';

  const [stock, setStock] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [inventorySubView, setInventorySubView] = useState('list'); // 'list' | 'form'
  const [inventorySuccessMsg, setInventorySuccessMsg] = useState('');
  const [profile, setProfile] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [view, setView] = useState(() => (isOwner ? 'branches' : 'dashboard'));
  const [previousOwnerView, setPreviousOwnerView] = useState('branches');
  const [resv, setResv] = useState([]);
  const [item, setItem] = useState(blank);
  const [err, setErr] = useState('');
  const [editingAddress, setEditingAddress] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState(null);
  const [typedAddress, setTypedAddress] = useState('');
  const [addressNeedsResolution, setAddressNeedsResolution] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressMsg, setAddressMsg] = useState({ type: '', text: '' });
  const [geocodeMsg, setGeocodeMsg] = useState('');
  const [reverseGeocoding, setReverseGeocoding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  // Branch management and selection state
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchListErr, setBranchListErr] = useState('');
  const [branchSuccessMsg, setBranchSuccessMsg] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState(() => {
    if (isStaff) {
      return auth.branch?.id || auth.branch?._id || '';
    }
    try {
      return localStorage.getItem('pf_selected_branch_' + auth.id) || '';
    } catch {
      return '';
    }
  });

  // Add Branch modal state
  const [showAddBranchModal, setShowAddBranchModal] = useState(false);
  const [addBranchForm, setAddBranchForm] = useState({ name: '', phone: '', address: '' });
  const [addBranchCoords, setAddBranchCoords] = useState(null);
  const [addBranchGeocodeMsg, setAddBranchGeocodeMsg] = useState({ type: '', text: '' });
  const [addBranchSuggestions, setAddBranchSuggestions] = useState([]);
  const [addBranchResolving, setAddBranchResolving] = useState(false);
  const [savingAddBranch, setSavingAddBranch] = useState(false);
  const [addBranchErr, setAddBranchErr] = useState('');

  // Edit Branch modal state
  const [editingBranch, setEditingBranch] = useState(null);
  const [editBranchForm, setEditBranchForm] = useState({ name: '', phone: '', address: '', isActive: true });
  const [editBranchCoords, setEditBranchCoords] = useState(null);
  const [editBranchGeocodeMsg, setEditBranchGeocodeMsg] = useState({ type: '', text: '' });
  const [editBranchSuggestions, setEditBranchSuggestions] = useState([]);
  const [editBranchResolving, setEditBranchResolving] = useState(false);
  const [savingEditBranch, setSavingEditBranch] = useState(false);
  const [editBranchErr, setEditBranchErr] = useState('');

  // Inter-branch transfers state (Task 8 & 9)
  const [transfers, setTransfers] = useState([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const [transferErr, setTransferErr] = useState('');
  const [transferSuccess, setTransferSuccess] = useState('');
  const [transferSubView, setTransferSubView] = useState('history'); // 'history' | 'request'
  const [transferStatusFilter, setTransferStatusFilter] = useState('all');
  const [transferDirectionFilter, setTransferDirectionFilter] = useState('all');
  const [availableOtherStock, setAvailableOtherStock] = useState([]);
  const [loadingAvailableStock, setLoadingAvailableStock] = useState(false);
  const [searchTransferQuery, setSearchTransferQuery] = useState('');
  const [selectedTransferCandidate, setSelectedTransferCandidate] = useState(null);
  const [transferRequestQty, setTransferRequestQty] = useState('');
  const [submittingTransfer, setSubmittingTransfer] = useState(false);
  const [submitTransferErr, setSubmitTransferErr] = useState('');

  // Task 9: Action & Modal state
  const [confirmModal, setConfirmModal] = useState(null); // { transfer, action: 'dispatch' | 'receive' | 'reject' | 'cancel' }
  const [actionReason, setActionReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionErr, setActionErr] = useState('');

  // Branch staff management state (Owner only)
  const [branchStaffList, setBranchStaffList] = useState([]);
  const [loadingBranchStaff, setLoadingBranchStaff] = useState(false);
  const [branchStaffErr, setBranchStaffErr] = useState('');
  const [branchStaffSuccess, setBranchStaffSuccess] = useState('');
  const [showAddStaffModal, setShowAddStaffModal] = useState(false);
  const [addStaffForm, setAddStaffForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [savingStaff, setSavingStaff] = useState(false);
  const [addStaffErr, setAddStaffErr] = useState('');

  // Branch Activity History state (Owner only)
  const [activityLogs, setActivityLogs] = useState([]);
  const [loadingActivityLogs, setLoadingActivityLogs] = useState(false);
  const [activityLogsErr, setActivityLogsErr] = useState('');
  const [activityCategoryFilter, setActivityCategoryFilter] = useState('all');
  const [activityActorFilter, setActivityActorFilter] = useState('all');
  const [activityDateFilter, setActivityDateFilter] = useState('all');
  const [activitySearchQuery, setActivitySearchQuery] = useState('');
  const [expandedActivityIds, setExpandedActivityIds] = useState({});
  const [refreshSuccessNotice, setRefreshSuccessNotice] = useState(false);
  const [activitySkip, setActivitySkip] = useState(0);
  const [hasMoreActivities, setHasMoreActivities] = useState(true);
  const [loadingMoreActivities, setLoadingMoreActivities] = useState(false);
  const ACTIVITY_PAGE_SIZE = 20;

  const token = auth.token;
  const profileMenuRef = useRef(null);
  const reverseGeocodeReqIdRef = useRef(0);
  const selectedBranchIdRef = useRef(selectedBranchId);

  useEffect(() => {
    selectedBranchIdRef.current = selectedBranchId;
  }, [selectedBranchId]);

  const activeBranch = useMemo(() => {
    if (isStaff) {
      const b = profile?.branch || auth.branch;
      return b
        ? {
            _id: b.id || b._id,
            name: b.name,
            address: b.address,
            phone: b.phone || '',
            location: b.location || null,
            isMain: b.isMain
          }
        : null;
    }
    return branches.find(b => b._id === selectedBranchId) || null;
  }, [isStaff, auth.branch, profile?.branch, branches, selectedBranchId]);

  const currentBranchId = useMemo(() => {
    if (isStaff) {
      return String(auth.branch?.id || auth.branch?._id || '');
    }
    return String(selectedBranchId || '');
  }, [isStaff, auth.branch, selectedBranchId]);

  const isIncomingTransfer = (t) => {
    if (!currentBranchId) return false;
    const destId = String(t.toBranch?._id || t.toBranch);
    return destId === currentBranchId;
  };

  const isOutgoingTransfer = (t) => {
    if (!currentBranchId) return false;
    const srcId = String(t.fromBranch?._id || t.fromBranch);
    return srcId === currentBranchId;
  };

  // Permission checkers for Task 9 actions respecting branch context
  const canApprove = (t) => {
    if (t.status !== 'pending') return false;
    if (isOwner) return isOutgoingTransfer(t);
    const staffBranch = String(auth.branch?.id || auth.branch?._id || '');
    return isStaff && String(t.fromBranch?._id || t.fromBranch) === staffBranch;
  };

  const canReject = (t) => {
    if (t.status !== 'pending') return false;
    if (isOwner) return isOutgoingTransfer(t);
    const staffBranch = String(auth.branch?.id || auth.branch?._id || '');
    return isStaff && String(t.fromBranch?._id || t.fromBranch) === staffBranch;
  };

  const canDispatch = (t) => {
    if (t.status !== 'approved') return false;
    if (isOwner) return isOutgoingTransfer(t);
    const staffBranch = String(auth.branch?.id || auth.branch?._id || '');
    return isStaff && String(t.fromBranch?._id || t.fromBranch) === staffBranch;
  };

  const canReceive = (t) => {
    if (t.status !== 'dispatched') return false;
    if (isOwner) return isIncomingTransfer(t);
    const staffBranch = String(auth.branch?.id || auth.branch?._id || '');
    return isStaff && String(t.toBranch?._id || t.toBranch) === staffBranch;
  };

  const canCancel = (t) => {
    if (!['pending', 'approved'].includes(t.status)) return false;
    if (isOwner) return isIncomingTransfer(t);
    const staffBranch = String(auth.branch?.id || auth.branch?._id || '');
    const isRequesterUser = String(t.requestedBy?.userId) === String(auth.id);
    const isDestStaff = String(t.toBranch?._id || t.toBranch) === staffBranch;
    return isStaff && (isRequesterUser || isDestStaff);
  };

  const filteredTransfers = useMemo(() => {
    return transfers.filter(t => {
      // Ensure transfer belongs to the currently active branch
      if (currentBranchId && !isIncomingTransfer(t) && !isOutgoingTransfer(t)) {
        return false;
      }

      // Direction filter
      if (transferDirectionFilter === 'incoming' && !isIncomingTransfer(t)) return false;
      if (transferDirectionFilter === 'outgoing' && !isOutgoingTransfer(t)) return false;

      // Status filter
      if (transferStatusFilter === 'all') return true;
      if (transferStatusFilter === 'closed') return ['rejected', 'cancelled'].includes(t.status);
      return t.status === transferStatusFilter;
    });
  }, [transfers, transferDirectionFilter, transferStatusFilter, currentBranchId]);

  const pendingTransfersCount = useMemo(() => {
    return transfers.filter(t => {
      if (currentBranchId && !isIncomingTransfer(t) && !isOutgoingTransfer(t)) {
        return false;
      }
      return t.status === 'pending';
    }).length;
  }, [transfers, currentBranchId]);

  const filteredActivityLogs = useMemo(() => {
    return activityLogs.filter(log => {
      // 1. Category filter
      if (activityCategoryFilter === 'inventory') {
        const isInv = log.targetEntityType === 'Stock' ||
          (log.actionType && (log.actionType.startsWith('medicine_') || log.actionType.startsWith('stock_')));
        if (!isInv) return false;
      } else if (activityCategoryFilter === 'reservations') {
        const isRes = log.targetEntityType === 'Reservation' ||
          (log.actionType && log.actionType.startsWith('reservation_'));
        if (!isRes) return false;
      } else if (activityCategoryFilter === 'transfers') {
        const isTrf = log.targetEntityType === 'TransferRequest' ||
          (log.actionType && log.actionType.startsWith('transfer_'));
        if (!isTrf) return false;
      }

      // 2. Actor filter
      if (activityActorFilter === 'owner') {
        const isOwnerActor = log.actor?.actorType === 'Owner' || log.actor?.role === 'pharmacy';
        if (!isOwnerActor) return false;
      } else if (activityActorFilter === 'staff') {
        const isStaffActor = log.actor?.actorType === 'Staff' || log.actor?.role === 'staff';
        if (!isStaffActor) return false;
      }

      // 3. Date Range Filter
      if (activityDateFilter !== 'all') {
        const logTime = new Date(log.createdAt).getTime();
        const now = Date.now();
        if (activityDateFilter === 'today') {
          const oneDay = 24 * 60 * 60 * 1000;
          if (now - logTime > oneDay) return false;
        } else if (activityDateFilter === '7days') {
          const sevenDays = 7 * 24 * 60 * 60 * 1000;
          if (now - logTime > sevenDays) return false;
        } else if (activityDateFilter === '30days') {
          const thirtyDays = 30 * 24 * 60 * 60 * 1000;
          if (now - logTime > thirtyDays) return false;
        }
      }

      // 4. Search Query Filter
      if (activitySearchQuery && activitySearchQuery.trim()) {
        const q = activitySearchQuery.trim().toLowerCase();
        const desc = (log.description || '').toLowerCase();
        const actorName = (log.actor?.displayName || '').toLowerCase();
        const actorRole = (log.actor?.actorType || log.actor?.role || '').toLowerCase();
        const med = (log.details?.medicine || '').toLowerCase();
        const reason = (log.details?.reason || '').toLowerCase();
        const patient = (log.details?.patientName || '').toLowerCase();
        const action = (log.actionType || '').toLowerCase().replace(/_/g, ' ');
        const meta = getActivityActionMeta(log.actionType);
        const metaLabel = (meta.label || '').toLowerCase();

        const match = desc.includes(q) ||
          actorName.includes(q) ||
          actorRole.includes(q) ||
          med.includes(q) ||
          reason.includes(q) ||
          patient.includes(q) ||
          action.includes(q) ||
          metaLabel.includes(q);

        if (!match) return false;
      }

      return true;
    });
  }, [activityLogs, activityCategoryFilter, activityActorFilter, activityDateFilter, activitySearchQuery]);

  const categoryCounts = useMemo(() => {
    let inv = 0;
    let resvCount = 0;
    let trf = 0;
    for (const log of activityLogs) {
      if (log.targetEntityType === 'Stock' || (log.actionType && (log.actionType.startsWith('medicine_') || log.actionType.startsWith('stock_')))) {
        inv++;
      } else if (log.targetEntityType === 'Reservation' || (log.actionType && log.actionType.startsWith('reservation_'))) {
        resvCount++;
      } else if (log.targetEntityType === 'TransferRequest' || (log.actionType && log.actionType.startsWith('transfer_'))) {
        trf++;
      }
    }
    return { all: activityLogs.length, inventory: inv, reservations: resvCount, transfers: trf };
  }, [activityLogs]);

  const toggleExpandActivity = (id) => {
    setExpandedActivityIds(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const expandAllActivities = () => {
    const all = {};
    filteredActivityLogs.forEach(l => { all[l._id] = true; });
    setExpandedActivityIds(all);
  };

  const collapseAllActivities = () => {
    setExpandedActivityIds({});
  };

  const handleClearActivityFilters = () => {
    setActivityCategoryFilter('all');
    setActivityActorFilter('all');
    setActivityDateFilter('all');
    setActivitySearchQuery('');
  };

  const hasActiveActivityFilters = activityCategoryFilter !== 'all' ||
    activityActorFilter !== 'all' ||
    activityDateFilter !== 'all' ||
    Boolean(activitySearchQuery.trim());

  const handleRefreshActivities = async () => {
    if (!activeBranch?._id || loadingActivityLogs) return;
    setRefreshSuccessNotice(false);
    await loadActivityLogs(activeBranch._id, 0, false);
    setRefreshSuccessNotice(true);
    setTimeout(() => {
      setRefreshSuccessNotice(false);
    }, 3000);
  };

  const loadActivityLogs = async (branchId, skip = 0, isAppend = false) => {
    if (!isOwner || !branchId) return;
    try {
      if (isAppend) {
        setLoadingMoreActivities(true);
      } else {
        setLoadingActivityLogs(true);
        setActivityLogsErr('');
      }

      const data = await api(`/pharmacy/activity-logs?branchId=${branchId}&limit=${ACTIVITY_PAGE_SIZE}&skip=${skip}`, { token });
      if (Array.isArray(data)) {
        if (isAppend) {
          setActivityLogs(prev => {
            const existingIds = new Set(prev.map(l => l._id));
            const fresh = data.filter(l => !existingIds.has(l._id));
            return [...prev, ...fresh];
          });
        } else {
          setActivityLogs(data);
        }
        setActivitySkip(skip + data.length);
        setHasMoreActivities(data.length === ACTIVITY_PAGE_SIZE);
      }
    } catch (e) {
      console.error('Failed to load activity logs:', e);
      setActivityLogsErr(e.message || 'Failed to load activity history');
    } finally {
      setLoadingActivityLogs(false);
      setLoadingMoreActivities(false);
    }
  };

  const resetAndLoadActivityLogs = (branchId) => {
    setActivityLogs([]);
    setActivitySkip(0);
    setHasMoreActivities(true);
    setActivityLogsErr('');
    loadActivityLogs(branchId, 0, false);
  };

  const loadTransfers = async (explicitBranchId) => {
    try {
      setLoadingTransfers(true);
      setTransferErr('');
      const branchIdToQuery = explicitBranchId || (isOwner ? (selectedBranchId || selectedBranchIdRef.current) : (auth.branch?.id || auth.branch?._id));
      const url = branchIdToQuery ? `/pharmacy/transfers?branchId=${branchIdToQuery}` : '/pharmacy/transfers';
      const data = await api(url, { token });
      setTransfers(Array.isArray(data) ? data : []);
    } catch (e) {
      setTransferErr(e.message || 'Failed to load transfer requests');
    } finally {
      setLoadingTransfers(false);
    }
  };

  const handleTransferAction = async (transferId, action, extra = {}) => {
    try {
      setActionBusy(true);
      setActionErr('');
      setTransferErr('');
      setTransferSuccess('');
      const updated = await api(`/pharmacy/transfers/${transferId}/status`, {
        method: 'PATCH',
        token,
        body: { status: action, ...extra }
      });
      setTransferSuccess(`Transfer successfully updated to "${updated.status}".`);
      setConfirmModal(null);
      setActionReason('');
      await Promise.all([
        loadTransfers(),
        loadAvailableStock(),
        load()
      ]);
    } catch (e) {
      setActionErr(e.message || `Failed to ${action} transfer`);
      setTransferErr(e.message || `Failed to ${action} transfer`);
    } finally {
      setActionBusy(false);
    }
  };

  const loadAvailableStock = async (query = '') => {
    try {
      setLoadingAvailableStock(true);
      const destId = isOwner ? (selectedBranchId || selectedBranchIdRef.current) : (auth.branch?.id || auth.branch?._id);
      const params = new URLSearchParams();
      if (destId) params.append('toBranchId', destId);
      if (query && query.trim()) params.append('q', query.trim());
      const data = await api(`/pharmacy/transfers/available-stock?${params.toString()}`, { token });
      setAvailableOtherStock(Array.isArray(data) ? data : []);
    } catch {
      setAvailableOtherStock([]);
    } finally {
      setLoadingAvailableStock(false);
    }
  };

  const handleSubmitTransfer = async (e) => {
    e.preventDefault();
    if (!selectedTransferCandidate || submittingTransfer) return;
    setSubmitTransferErr('');
    setTransferSuccess('');

    const qty = Number(transferRequestQty);
    if (!Number.isInteger(qty) || qty < 1) {
      setSubmitTransferErr('Please enter a valid positive integer quantity');
      return;
    }
    if (qty > selectedTransferCandidate.availableQuantity) {
      setSubmitTransferErr(`Requested quantity (${qty}) exceeds available stock (${selectedTransferCandidate.availableQuantity})`);
      return;
    }

    const destId = isOwner ? selectedBranchId : (auth.branch?.id || auth.branch?._id);
    if (!destId) {
      setSubmitTransferErr('Destination branch could not be resolved');
      return;
    }

    try {
      setSubmittingTransfer(true);
      const res = await api('/pharmacy/transfers', {
        method: 'POST',
        token,
        body: {
          fromBranch: selectedTransferCandidate.branch._id,
          toBranch: destId,
          medicine: selectedTransferCandidate.medicine,
          requestedQuantity: qty
        }
      });

      setTransferSuccess(`Transfer request for ${qty} units of "${res.medicine}" created with status "pending".`);
      setSelectedTransferCandidate(null);
      setTransferRequestQty('');
      setTransferSubView('history');
      await loadTransfers();
      await loadAvailableStock(searchTransferQuery);
      setTimeout(() => setTransferSuccess(''), 5000);
    } catch (err) {
      setSubmitTransferErr(err.message || 'Failed to submit transfer request');
    } finally {
      setSubmittingTransfer(false);
    }
  };

  const load = async (overrideBranchId) => {
    try {
      setLoading(true);
      const branchIdToQuery = overrideBranchId !== undefined ? overrideBranchId : selectedBranchIdRef.current;
      const queryParam = isOwner && branchIdToQuery ? `?branchId=${encodeURIComponent(branchIdToQuery)}` : '';
      const [s, r] = await Promise.all([
        api('/pharmacy/stock' + queryParam, { token }),
        api('/pharmacy/reservations' + queryParam, { token })
      ]);
      setStock(s);
      setResv(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadBranches = async () => {
    if (!isOwner) return [];
    try {
      setLoadingBranches(true);
      setBranchListErr('');
      const data = await api('/pharmacy/branches', { token });
      const branchList = Array.isArray(data) ? data : [];
      setBranches(branchList);

      // Resolve valid selected branch
      let targetBranch = null;
      const savedBranchId = localStorage.getItem('pf_selected_branch_' + auth.id);

      if (savedBranchId && branchList.some(b => b._id === savedBranchId)) {
        targetBranch = branchList.find(b => b._id === savedBranchId);
      } else {
        targetBranch = branchList.find(b => b.isMain) || branchList[0] || null;
      }

      if (targetBranch) {
        setSelectedBranchId(targetBranch._id);
        localStorage.setItem('pf_selected_branch_' + auth.id, targetBranch._id);
        await load(targetBranch._id);
      } else {
        await load();
      }

      return branchList;
    } catch (e) {
      setBranchListErr(e.message);
      await load();
      return [];
    } finally {
      setLoadingBranches(false);
    }
  };

  const loadProfile = async () => {
    if (!isOwner) {
      try {
        const staffData = await api('/staff/profile', { token });
        setProfile({
          ...staffData.pharmacy,
          staff: staffData.staff,
          branch: staffData.branch,
          pharmacy: staffData.pharmacy,
          ownerName: staffData.pharmacy?.ownerName,
          pharmacyName: staffData.pharmacy?.name,
          email: staffData.staff?.email || auth.email,
          name: staffData.staff?.name || auth.name
        });
        return staffData;
      } catch {
        try {
          const pharm = await api('/pharmacy/profile', { token });
          setProfile({
            ...pharm,
            pharmacy: pharm,
            staff: { name: auth.name, email: auth.email, role: 'staff' },
            branch: auth.branch
          });
        } catch {
          setProfile({
            name: auth.name,
            email: auth.email,
            staff: { name: auth.name, email: auth.email, role: 'staff' },
            branch: auth.branch
          });
        }
        return null;
      }
    }
    try {
      const data = await api('/pharmacy/profile', { token });
      setProfile(data);
      if (data?.address) {
        setTypedAddress(data.address);
      }
      const saved = parseCoordinates(data?.location);
      if (saved) {
        setSelectedLocation(saved);
      }
      return data;
    } catch (e) {
      setErr(e.message);
      return null;
    }
  };

  const loadBranchStaff = async (branchId) => {
    if (!isOwner || !branchId) return;
    try {
      setLoadingBranchStaff(true);
      setBranchStaffErr('');
      const data = await api(`/pharmacy/branches/${branchId}/staff`, { token });
      setBranchStaffList(Array.isArray(data) ? data : []);
    } catch (e) {
      setBranchStaffErr(e.message || 'Failed to load branch staff');
    } finally {
      setLoadingBranchStaff(false);
    }
  };

  const handleAddStaffSubmit = async (e) => {
    e.preventDefault();
    if (savingStaff || !activeBranch) return;
    setAddStaffErr('');
    setBranchStaffSuccess('');

    const cleanName = (addStaffForm.name || '').trim();
    const cleanEmail = (addStaffForm.email || '').trim().toLowerCase();
    const password = addStaffForm.password || '';
    const confirmPassword = addStaffForm.confirmPassword || '';

    if (!cleanName) {
      setAddStaffErr('Staff full name is required');
      return;
    }
    if (!cleanEmail) {
      setAddStaffErr('Staff email is required');
      return;
    }
    if (password.length < 6) {
      setAddStaffErr('Password must be at least 6 characters');
      return;
    }
    if (password !== confirmPassword) {
      setAddStaffErr('Confirm password does not match temporary password');
      return;
    }

    try {
      setSavingStaff(true);
      const newStaff = await api(`/pharmacy/branches/${activeBranch._id}/staff`, {
        method: 'POST',
        token,
        body: {
          name: cleanName,
          email: cleanEmail,
          password
        }
      });
      setBranchStaffSuccess(`Staff member "${newStaff.name}" registered successfully.`);
      setAddStaffForm({ name: '', email: '', password: '', confirmPassword: '' });
      setShowAddStaffModal(false);
      await loadBranchStaff(activeBranch._id);
      setTimeout(() => setBranchStaffSuccess(''), 4000);
    } catch (err) {
      setAddStaffErr(err.message || 'Failed to register staff');
    } finally {
      setSavingStaff(false);
    }
  };

  const handleToggleStaffStatus = async (staffMember) => {
    if (!activeBranch?._id || !staffMember?._id) return;
    try {
      setBranchStaffErr('');
      const targetStatus = !(staffMember.isActive !== false);
      const updated = await api(`/pharmacy/branches/${activeBranch._id}/staff/${staffMember._id}/status`, {
        method: 'PATCH',
        token,
        body: { isActive: targetStatus }
      });
      setBranchStaffList(list => list.map(s => (s._id === updated._id ? { ...s, isActive: updated.isActive } : s)));
      setBranchStaffSuccess(`Staff member "${updated.name}" account ${updated.isActive ? 'activated' : 'deactivated'} successfully.`);
      setTimeout(() => setBranchStaffSuccess(''), 4000);
    } catch (e) {
      setBranchStaffErr(e.message || 'Failed to update staff status');
    }
  };

  useEffect(() => {
    if (isOwner) {
      loadBranches();
      loadProfile();
    } else {
      load();
      loadProfile();
    }
  }, []);

  useEffect(() => {
    if (view === 'profile') {
      if (isOwner) {
        if (branches.length === 0) loadBranches();
        if (!profile) loadProfile();
      } else {
        loadProfile();
      }
    }
  }, [view, isOwner]);

  useEffect(() => {
    if ((view === 'staff-management' || view === 'branch-profile') && isOwner && activeBranch?._id) {
      loadBranchStaff(activeBranch._id);
    }
  }, [view, isOwner, activeBranch?._id]);

  useEffect(() => {
    if (view === 'transfers') {
      loadTransfers(selectedBranchId);
      loadAvailableStock();
    }
  }, [view, selectedBranchId]);

  useEffect(() => {
    if (view === 'activity-history' && isOwner && activeBranch?._id) {
      resetAndLoadActivityLogs(activeBranch._id);
    }
  }, [view, isOwner, activeBranch?._id]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      load().catch(e => setErr(e.message));
      if (view === 'activity-history' && activeBranch?._id) {
        loadActivityLogs(activeBranch._id, 0, false);
      }
    };
    const onTransferChange = () => {
      loadTransfers();
      loadAvailableStock();
      load().catch(e => setErr(e.message));
      if (view === 'activity-history' && activeBranch?._id) {
        loadActivityLogs(activeBranch._id, 0, false);
      }
    };
    socket.on('reservation:new', refresh);
    socket.on('reservation:updated', refresh);
    socket.on('stock:updated', refresh);
    socket.on('transfer:new', onTransferChange);
    socket.on('transfer:status', onTransferChange);
    socket.on('transfer:updated', onTransferChange);
    return () => {
      socket.off('reservation:new', refresh);
      socket.off('reservation:updated', refresh);
      socket.off('stock:updated', refresh);
      socket.off('transfer:new', onTransferChange);
      socket.off('transfer:status', onTransferChange);
      socket.off('transfer:updated', onTransferChange);
    };
  }, [socket, view, activeBranch?._id]);

  const handleBranchChange = async (e) => {
    const nextBranchId = e.target.value;
    if (!nextBranchId) return;
    setSelectedBranchId(nextBranchId);
    localStorage.setItem('pf_selected_branch_' + auth.id, nextBranchId);
    setItem(blank);
    setInventorySubView('list');
    setTransferSubView('history');
    setInventorySuccessMsg('');
    await load(nextBranchId);
    if (isOwner && view === 'branches') {
      setView('dashboard');
    } else if (isOwner && view === 'activity-history') {
      resetAndLoadActivityLogs(nextBranchId);
    }
  };

  const openBranchDashboard = (branchId, targetSubView = 'dashboard') => {
    setSelectedBranchId(branchId);
    localStorage.setItem('pf_selected_branch_' + auth.id, branchId);
    setItem(blank);
    setInventorySubView('list');
    setTransferSubView('history');
    setInventorySuccessMsg('');
    load(branchId);
    setView(targetSubView);
    setPreviousOwnerView(targetSubView);
    if (targetSubView === 'activity-history') {
      resetAndLoadActivityLogs(branchId);
    }
  };

  // Add Branch Handlers
  const handleFindOnMapAdd = async () => {
    const cleanAddress = String(addBranchForm.address || '').trim();
    if (!cleanAddress) {
      setAddBranchErr('Please enter a branch address to find on the map.');
      return;
    }
    setAddBranchResolving(true);
    setAddBranchErr('');
    setAddBranchGeocodeMsg({ type: '', text: '' });
    setAddBranchSuggestions([]);

    try {
      const outcome = await searchAddressWithFallback(cleanAddress);
      if (!outcome.success || outcome.results.length === 0) {
        setAddBranchGeocodeMsg({
          type: 'error',
          text: outcome.error || 'Could not find this address or nearby locality on the map. Please refine the address or click the map directly.'
        });
        return;
      }

      setAddBranchSuggestions(outcome.results);

      const topResult = outcome.results[0];
      setAddBranchCoords({ lat: topResult.lat, lng: topResult.lng });

      if (topResult.precision === 'exact') {
        setAddBranchGeocodeMsg({
          type: 'exact',
          text: `✓ Exact address match found for "${topResult.shortName}". Map pin positioned at location. Click or drag to adjust.`
        });
      } else {
        const unmatchedNote = topResult.unmatchedPart ? `Street or colony "${topResult.unmatchedPart}" was not found as a mapped entity on OpenStreetMap. ` : '';
        setAddBranchGeocodeMsg({
          type: 'approx',
          text: `⚠️ Approximate locality match (${topResult.matchedQuery}). ${unmatchedNote}The pin has been placed at the locality center. Please click or drag the marker to your pharmacy's exact building location.`
        });
      }
    } catch {
      setAddBranchGeocodeMsg({
        type: 'error',
        text: 'Address search failed. Please verify connection or select on the map directly.'
      });
    } finally {
      setAddBranchResolving(false);
    }
  };

  const handleSelectAddSuggestion = (item) => {
    setAddBranchCoords({ lat: item.lat, lng: item.lng });
    if (item.precision === 'exact') {
      setAddBranchGeocodeMsg({
        type: 'exact',
        text: `✓ Selected exact match: "${item.shortName}". Map pin updated.`
      });
    } else {
      setAddBranchGeocodeMsg({
        type: 'approx',
        text: `⚠️ Selected approximate locality (${item.matchedQuery}). Please click or drag the marker to your pharmacy's exact building location.`
      });
    }
    // Full user-entered address in addBranchForm.address remains completely preserved!
  };

  const handleBranchLocationChangeAdd = (coords) => {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return;
    setAddBranchCoords(coords);
    setAddBranchGeocodeMsg({
      type: 'manual',
      text: `📍 Pin position manually set to: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}. Address field was preserved.`
    });
  };

  const handleAddBranchSubmit = async (e) => {
    e.preventDefault();
    if (savingAddBranch) return;
    setAddBranchErr('');

    const name = String(addBranchForm.name || '').trim();
    const address = String(addBranchForm.address || '').trim();
    const phone = String(addBranchForm.phone || '').trim();

    if (!name) {
      setAddBranchErr('Branch name is required.');
      return;
    }
    if (!address) {
      setAddBranchErr('Branch address is required.');
      return;
    }
    if (!addBranchCoords || !Number.isFinite(addBranchCoords.lat) || !Number.isFinite(addBranchCoords.lng)) {
      setAddBranchErr('Please select a valid location for the branch on the map.');
      return;
    }

    try {
      setSavingAddBranch(true);
      const newBranch = await api('/pharmacy/branches', {
        method: 'POST',
        token,
        body: {
          name,
          address,
          phone,
          coordinates: [Number(addBranchCoords.lng), Number(addBranchCoords.lat)]
        }
      });

      setShowAddBranchModal(false);
      setAddBranchForm({ name: '', phone: '', address: '' });
      setAddBranchCoords(null);
      setAddBranchGeocodeMsg({ type: '', text: '' });
      setAddBranchSuggestions([]);
      setBranchSuccessMsg(`Branch "${newBranch.name}" created successfully.`);

      const updatedBranches = await api('/pharmacy/branches', { token });
      setBranches(updatedBranches);

      setTimeout(() => setBranchSuccessMsg(''), 4000);
    } catch (e2) {
      setAddBranchErr(e2.message || 'Failed to create branch.');
    } finally {
      setSavingAddBranch(false);
    }
  };

  // Edit Branch Handlers
  const openEditBranchModal = (branch) => {
    setEditingBranch(branch);
    setEditBranchForm({
      name: branch.name || '',
      phone: branch.phone || '',
      address: branch.address || '',
      isActive: branch.isActive !== false
    });
    const parsed = parseCoordinates(branch.location);
    setEditBranchCoords(parsed);
    setEditBranchErr('');
    setEditBranchGeocodeMsg({ type: '', text: '' });
    setEditBranchSuggestions([]);
  };

  const handleFindOnMapEdit = async () => {
    const cleanAddress = String(editBranchForm.address || '').trim();
    if (!cleanAddress) {
      setEditBranchErr('Please enter a branch address to find on the map.');
      return;
    }
    setEditBranchResolving(true);
    setEditBranchErr('');
    setEditBranchGeocodeMsg({ type: '', text: '' });
    setEditBranchSuggestions([]);

    try {
      const outcome = await searchAddressWithFallback(cleanAddress);
      if (!outcome.success || outcome.results.length === 0) {
        setEditBranchGeocodeMsg({
          type: 'error',
          text: outcome.error || 'Could not find this address or nearby locality on the map. Please refine the address or click the map directly.'
        });
        return;
      }

      setEditBranchSuggestions(outcome.results);

      const topResult = outcome.results[0];
      setEditBranchCoords({ lat: topResult.lat, lng: topResult.lng });

      if (topResult.precision === 'exact') {
        setEditBranchGeocodeMsg({
          type: 'exact',
          text: `✓ Exact address match found for "${topResult.shortName}". Map pin positioned at location. Click or drag to adjust.`
        });
      } else {
        const unmatchedNote = topResult.unmatchedPart ? `Street or colony "${topResult.unmatchedPart}" was not found as a mapped entity on OpenStreetMap. ` : '';
        setEditBranchGeocodeMsg({
          type: 'approx',
          text: `⚠️ Approximate locality match (${topResult.matchedQuery}). ${unmatchedNote}The pin has been placed at the locality center. Please click or drag the marker to your pharmacy's exact building location.`
        });
      }
    } catch {
      setEditBranchGeocodeMsg({
        type: 'error',
        text: 'Address search failed. Please verify connection or select on the map directly.'
      });
    } finally {
      setEditBranchResolving(false);
    }
  };

  const handleSelectEditSuggestion = (item) => {
    setEditBranchCoords({ lat: item.lat, lng: item.lng });
    if (item.precision === 'exact') {
      setEditBranchGeocodeMsg({
        type: 'exact',
        text: `✓ Selected exact match: "${item.shortName}". Map pin updated.`
      });
    } else {
      setEditBranchGeocodeMsg({
        type: 'approx',
        text: `⚠️ Selected approximate locality (${item.matchedQuery}). Please click or drag the marker to your pharmacy's exact building location.`
      });
    }
    // Full user-entered address in editBranchForm.address remains completely preserved!
  };

  const handleBranchLocationChangeEdit = (coords) => {
    if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return;
    setEditBranchCoords(coords);
    setEditBranchGeocodeMsg({
      type: 'manual',
      text: `📍 Pin position manually set to: ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}. Address field was preserved.`
    });
  };

  const handleEditBranchSubmit = async (e) => {
    e.preventDefault();
    if (savingEditBranch || !editingBranch) return;
    setEditBranchErr('');

    const name = String(editBranchForm.name || '').trim();
    const address = String(editBranchForm.address || '').trim();
    const phone = String(editBranchForm.phone || '').trim();

    if (!name) {
      setEditBranchErr('Branch name is required.');
      return;
    }
    if (!address) {
      setEditBranchErr('Branch address is required.');
      return;
    }
    if (!editBranchCoords || !Number.isFinite(editBranchCoords.lat) || !Number.isFinite(editBranchCoords.lng)) {
      setEditBranchErr('Please select a valid location for the branch on the map.');
      return;
    }

    try {
      setSavingEditBranch(true);
      const updated = await api(`/pharmacy/branches/${editingBranch._id}`, {
        method: 'PUT',
        token,
        body: {
          name,
          address,
          phone,
          coordinates: [Number(editBranchCoords.lng), Number(editBranchCoords.lat)],
          isActive: editBranchForm.isActive
        }
      });

      setEditingBranch(null);
      setEditBranchSuggestions([]);
      setEditBranchGeocodeMsg({ type: '', text: '' });
      setBranchSuccessMsg(`Branch "${updated.name}" updated successfully.`);

      const updatedBranches = await api('/pharmacy/branches', { token });
      setBranches(updatedBranches);

      setTimeout(() => setBranchSuccessMsg(''), 4000);
    } catch (e2) {
      setEditBranchErr(e2.message || 'Failed to update branch.');
    } finally {
      setSavingEditBranch(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = e => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target)) {
        setProfileMenuOpen(false);
      }
    };
    if (profileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [profileMenuOpen]);

  useEffect(() => {
    if (!editingAddress && profile) {
      if (profile.address) {
        setTypedAddress(profile.address);
      }
      const saved = parseCoordinates(profile.location);
      if (saved) {
        setSelectedLocation(saved);
      }
      setAddressNeedsResolution(false);
    }
  }, [profile?.location, profile?.address, editingAddress]);

  const handleAddressInputChange = e => {
    const nextVal = e.target.value;
    setTypedAddress(nextVal);
    setAddressMsg({ type: '', text: '' });
    setGeocodeMsg('');
    reverseGeocodeReqIdRef.current++;

    const currentSaved = String(profile?.address || '').trim();
    if (nextVal.trim() !== currentSaved) {
      setAddressNeedsResolution(true);
    } else {
      setAddressNeedsResolution(false);
    }
  };

  const handleFindOnMap = async () => {
    const cleanAddress = String(typedAddress || '').trim();
    if (!cleanAddress) {
      setAddressMsg({ type: 'error', text: 'Please enter a pharmacy address to find on the map.' });
      return;
    }

    setResolvingAddress(true);
    setAddressMsg({ type: '', text: '' });
    setGeocodeMsg('');

    const reqId = ++reverseGeocodeReqIdRef.current;

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cleanAddress)}&limit=1`,
        {
          headers: {
            'Accept': 'application/json'
          }
        }
      );

      if (reqId !== reverseGeocodeReqIdRef.current) return;

      if (!response.ok) {
        throw new Error('Address search failed');
      }

      const data = await response.json();
      if (reqId !== reverseGeocodeReqIdRef.current) return;

      if (Array.isArray(data) && data.length > 0) {
        const item = data[0];
        const lat = Number(item.lat);
        const lng = Number(item.lon);

        if (
          Number.isFinite(lat) &&
          Number.isFinite(lng) &&
          lat >= -90 &&
          lat <= 90 &&
          lng >= -180 &&
          lng <= 180
        ) {
          const nextPos = { lat, lng };
          setSelectedLocation(nextPos);
          setAddressNeedsResolution(false);
          setGeocodeMsg('✓ Location found and pinned on the map.');
          setAddressMsg({ type: '', text: '' });
          return;
        }
      }

      setGeocodeMsg('Could not find this address on the map. Please refine the address or click/drag the marker on the map to set the location.');
    } catch (e) {
      if (reqId !== reverseGeocodeReqIdRef.current) return;
      setGeocodeMsg('Address search failed. Please verify your connection or select the location directly on the map.');
    } finally {
      if (reqId === reverseGeocodeReqIdRef.current) {
        setResolvingAddress(false);
      }
    }
  };

  const handleLocationChange = async (coords) => {
    if (!coords || !Number.isFinite(Number(coords.lat)) || !Number.isFinite(Number(coords.lng))) {
      return;
    }

    const nextLat = Number(coords.lat);
    const nextLng = Number(coords.lng);

    if (nextLat < -90 || nextLat > 90 || nextLng < -180 || nextLng > 180) {
      return;
    }

    const nextPos = {
      lat: nextLat,
      lng: nextLng
    };

    // 1. Immediately update selected coordinates in React state
    setSelectedLocation(nextPos);
    // User manually selected a map location, so coordinates are deliberately chosen
    setAddressNeedsResolution(false);
    setReverseGeocoding(true);
    setGeocodeMsg('');
    setAddressMsg({ type: '', text: '' });

    const reqId = ++reverseGeocodeReqIdRef.current;

    // 2. Reverse-geocode selected coordinates using OpenStreetMap Nominatim
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${nextPos.lat}&lon=${nextPos.lng}&addressdetails=1`,
        {
          headers: {
            'Accept': 'application/json'
          }
        }
      );

      if (reqId !== reverseGeocodeReqIdRef.current) return;

      if (!response.ok) {
        throw new Error('Address lookup failed');
      }

      const data = await response.json();
      if (reqId !== reverseGeocodeReqIdRef.current) return;

      const address = data?.display_name || '';

      if (address) {
        setTypedAddress(address);
        setProfile(p => ({
          ...p,
          address
        }));
        setGeocodeMsg('');
      } else {
        setGeocodeMsg('Location coordinates selected, but no address name was found. Please enter or correct the address manually.');
      }
    } catch (error) {
      if (reqId !== reverseGeocodeReqIdRef.current) return;
      // 3. Keep selected coordinates and show clear message
      setGeocodeMsg('Location coordinates selected, but address lookup failed. Please enter or correct the address manually.');
    } finally {
      if (reqId === reverseGeocodeReqIdRef.current) {
        setReverseGeocoding(false);
      }
    }
  };

  const handleSaveAddress = async () => {
    if (savingAddress) return;

    setAddressMsg({ type: '', text: '' });
    setErr('');

    const cleanAddress = String(typedAddress || profile?.address || '').trim();

    if (!cleanAddress) {
      setAddressMsg({ type: 'error', text: 'Pharmacy address is required.' });
      return;
    }

    if (addressNeedsResolution) {
      setAddressMsg({
        type: 'error',
        text: 'Address text was changed. Please click "Find on Map" or select the location on the map before saving.'
      });
      return;
    }

    if (
      !selectedLocation ||
      !Number.isFinite(Number(selectedLocation.lat)) ||
      !Number.isFinite(Number(selectedLocation.lng))
    ) {
      setAddressMsg({ type: 'error', text: 'Please select a valid location on the map.' });
      return;
    }

    const lat = Number(selectedLocation.lat);
    const lng = Number(selectedLocation.lng);

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setAddressMsg({ type: 'error', text: 'Valid coordinates are required (latitude -90 to 90, longitude -180 to 180).' });
      return;
    }

    try {
      setSavingAddress(true);
      reverseGeocodeReqIdRef.current++;

      const payload = {
        address: cleanAddress,
        location: {
          type: 'Point',
          coordinates: [lng, lat]
        }
      };

      const savedPharmacy = await api('/pharmacy/profile/location', {
        method: 'PUT',
        token,
        body: payload
      });

      // Update displayed coordinates and profile directly using backend response
      if (savedPharmacy && savedPharmacy.location?.coordinates) {
        setProfile(savedPharmacy);
        setTypedAddress(savedPharmacy.address || cleanAddress);
        const saved = parseCoordinates(savedPharmacy.location);
        if (saved) {
          setSelectedLocation(saved);
        }
      }

      await loadProfile();

      setAddressMsg({ type: 'success', text: 'Address and map location updated successfully.' });
      setEditingAddress(false);
      setAddressNeedsResolution(false);
      setGeocodeMsg('');

      setTimeout(() => {
        setAddressMsg(m => m.type === 'success' ? { type: '', text: '' } : m);
      }, 4000);
    } catch (e) {
      setAddressMsg({ type: 'error', text: e.message || 'Failed to save pharmacy location.' });
    } finally {
      setSavingAddress(false);
    }
  };

  const displayCoordinates = useMemo(() => {
    if (
      editingAddress &&
      selectedLocation &&
      Number.isFinite(Number(selectedLocation.lat)) &&
      Number.isFinite(Number(selectedLocation.lng))
    ) {
      return {
        lat: Number(selectedLocation.lat),
        lng: Number(selectedLocation.lng)
      };
    }

    return parseCoordinates(profile?.location);
  }, [editingAddress, selectedLocation, profile?.location]);

  const handleOpenAddMedicine = () => {
    setItem(blank);
    setErr('');
    setInventorySuccessMsg('');
    setInventorySubView('form');
  };

  const handleOpenEditMedicine = (s) => {
    setItem({
      ...s,
      price: s.price ?? ''
    });
    setErr('');
    setInventorySuccessMsg('');
    setInventorySubView('form');
  };

  const handleCancelInventoryForm = () => {
    setItem(blank);
    setErr('');
    setInventorySubView('list');
  };

  const save = async e => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const payload = { ...item };
      if (isOwner && selectedBranchId) {
        payload.branchId = selectedBranchId;
      }
      await api('/pharmacy/stock', { method: 'PUT', token, body: payload });
      const savedMedName = item.medicine ? item.medicine.trim() : 'Medicine';
      const wasEditing = Boolean(item._id);
      setItem(blank);
      setInventorySubView('list');
      setInventorySuccessMsg(
        wasEditing
          ? `Successfully updated "${savedMedName}".`
          : `Successfully added "${savedMedName}" to inventory.`
      );
      setTimeout(() => setInventorySuccessMsg(''), 5000);
      await load(selectedBranchId);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const status = async (id, value) => {
    try {
      await api(`/pharmacy/reservations/${id}/status`, { method: 'PATCH', token, body: { status: value } });
      await load(selectedBranchId);
    } catch (e) {
      setErr(e.message);
    }
  };

  const totalStock = stock.reduce((n, s) => n + s.quantity, 0);
  const pending = resv.filter(r => ['held','confirmed','ready'].includes(r.status)).length;

  const getStockStatus = quantity => {
    if (quantity <= 0) return 'out_of_stock';
    if (quantity <= LOW_STOCK_THRESHOLD) return 'low_stock';
    return 'in_stock';
  };

  const inStockCount = stock.filter(s => s.quantity > LOW_STOCK_THRESHOLD).length;
  const lowStockCount = stock.filter(s => s.quantity > 0 && s.quantity <= LOW_STOCK_THRESHOLD).length;
  const outOfStockCount = stock.filter(s => s.quantity <= 0).length;

  const filteredStock = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return stock.filter(s => {
      const matchesSearch = !query ||
        (s.medicine && s.medicine.toLowerCase().includes(query)) ||
        (s.generic && s.generic.toLowerCase().includes(query));

      if (!matchesSearch) return false;

      const status = getStockStatus(s.quantity);
      if (stockFilter === 'all') return true;
      return status === stockFilter;
    });
  }, [stock, searchQuery, stockFilter]);

  const isOwnerBranchProfileContext = Boolean(
    isOwner && view === 'profile' && previousOwnerView !== 'branches' && activeBranch
  );

  return (
    <div className="app-shell">
      <header className="topbar pharmacy-topbar">
        <div className="brand">
          <div className="brand-logo-frame">
            <img
              src="/pharmatrack-logo.png"
              alt="PharmaTrack"
              className="brand-logo"
            />
          </div>
        </div>

        <nav className="pharmacy-nav" aria-label="Pharmacy navigation">
          {isOwner ? (
            <>
              {(view === 'branches' || (view === 'profile' && !isOwnerBranchProfileContext)) && (
                <button
                  type="button"
                  className={view === 'branches' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
                  onClick={() => {
                    setView('branches');
                    loadBranches();
                  }}
                >
                  Branches Overview
                  {branches.length > 0 && <span className="nav-badge branch-nav-badge">{branches.length}</span>}
                </button>
              )}

              {activeBranch && ((view !== 'branches' && view !== 'profile') || isOwnerBranchProfileContext) && (
                <>
                  <button
                    type="button"
                    className={view === 'dashboard' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
                    onClick={() => {
                      setView('dashboard');
                      setInventorySubView('list');
                      setInventorySuccessMsg('');
                      setErr('');
                    }}
                  >
                    Inventory
                  </button>

                  <button
                    type="button"
                    className={view === 'reservations' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
                    onClick={() => {
                      setView('reservations');
                      load();
                    }}
                  >
                    Reservations
                    {pending > 0 && <span className="nav-badge">{pending}</span>}
                  </button>

                  <button
                    type="button"
                    className={view === 'transfers' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
                    onClick={() => {
                      setView('transfers');
                      setTransferSubView('history');
                      loadTransfers();
                      loadAvailableStock();
                    }}
                  >
                    Transfers
                    {pendingTransfersCount > 0 && <span className="nav-badge transfer-nav-badge">{pendingTransfersCount}</span>}
                  </button>

                  <button
                    type="button"
                    className={view === 'staff-management' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
                    onClick={() => {
                      setView('staff-management');
                      if (activeBranch?._id) loadBranchStaff(activeBranch._id);
                    }}
                  >
                    Staff Management
                  </button>

                  <button
                    type="button"
                    className={view === 'branch-profile' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
                    onClick={() => setView('branch-profile')}
                  >
                    Branch Profile
                  </button>

                  <button
                    type="button"
                    className={view === 'activity-history' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
                    onClick={() => {
                      setView('activity-history');
                      if (activeBranch?._id) resetAndLoadActivityLogs(activeBranch._id);
                    }}
                  >
                    Activity History
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                className={view === 'dashboard' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
                onClick={() => {
                  setView('dashboard');
                  setInventorySubView('list');
                  setInventorySuccessMsg('');
                  setErr('');
                }}
              >
                Inventory
              </button>

              <button
                type="button"
                className={view === 'reservations' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
                onClick={() => {
                  setView('reservations');
                  load();
                }}
              >
                Reservations
                {pending > 0 && <span className="nav-badge">{pending}</span>}
              </button>

              <button
                type="button"
                className={view === 'transfers' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
                onClick={() => {
                  setView('transfers');
                  setTransferSubView('history');
                  loadTransfers();
                  loadAvailableStock();
                }}
              >
                Transfers
                {pendingTransfersCount > 0 && <span className="nav-badge transfer-nav-badge">{pendingTransfersCount}</span>}
              </button>
            </>
          )}
        </nav>

        {/* Assigned Branch Display (Staff Only) */}
        {isStaff && (
          <div className="branch-selector-header">
            <div className="branch-locked-display" title="Assigned branch for your staff account">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="branch-locked-name">{auth.branch?.name || 'Assigned Branch'}</span>
              <span className="branch-locked-badge">Staff Access</span>
            </div>
          </div>
        )}

        <div className="profile-menu-wrap" ref={profileMenuRef}>
          <button
            type="button"
            className={`profile-trigger ${view === 'profile' ? 'active' : ''}`}
            style={view === 'profile' ? {
              background: 'rgba(255, 255, 255, 0.24)',
              borderColor: 'rgba(255, 255, 255, 0.7)',
              boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.25)'
            } : undefined}
            onClick={() => {
              setProfileMenuOpen(open => !open);
              if (!profile) loadProfile();
            }}
            aria-expanded={profileMenuOpen}
          >
            <span className="profile-avatar">
              {(profile?.name || auth.name || 'P').trim().charAt(0).toUpperCase()}
            </span>
            <span>Profile</span>
            <span className="profile-arrow"></span>
          </button>

          {profileMenuOpen && (
            <div className="profile-dropdown">
              <button
                type="button"
                onClick={() => {
                  if (view !== 'profile') {
                    setPreviousOwnerView(view);
                  }
                  setView('profile');
                  setProfileMenuOpen(false);
                  loadProfile();
                  if (isOwner && branches.length === 0) loadBranches();
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                {isOwner ? 'Owner Profile' : 'My Profile'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false);
                  onLogout();
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>

      {view === 'dashboard' && (
        <>
          {isOwner && (
            <div className="branch-top-nav-bar">
              <button
                type="button"
                className="btn-back-branches"
                onClick={() => {
                  setView('branches');
                  loadBranches();
                }}
              >
                ← Back to Main Page
              </button>
            </div>
          )}
          <div className={`dashboard-head ${isOwner ? 'branch-dashboard-head' : ''}`}>
            <div>
              <p className="eyebrow">{isOwner ? 'PHARMACY OWNER DASHBOARD' : 'BRANCH STAFF DASHBOARD'}</p>
              <h1>{activeBranch?.name ? `${activeBranch.name} Inventory` : 'Manage your live inventory.'}</h1>
              {activeBranch && (
                <p className="branch-active-subtitle">
                  <span>📍 {activeBranch.address}</span>
                  {activeBranch.isMain && <span className="badge-main-branch">★ Main Branch</span>}
                  {activeBranch.phone && <span>• 📞 {activeBranch.phone}</span>}
                </p>
              )}
            </div>
          </div>
          {inventorySubView === 'form' ? (
            <main className="content-wrap inventory-form-view-wrap">
              <div className="inventory-view-top-bar">
                <button
                  type="button"
                  className="btn-back-to-inventory"
                  onClick={handleCancelInventoryForm}
                >
                  ← Back to Inventory
                </button>
              </div>

              <section className="panel inventory-form-panel">
                <div className="panel-head inventory-form-header">
                  <div>
                    <p className="eyebrow">{item._id ? 'INVENTORY MANAGEMENT' : 'NEW MEDICINE'}</p>
                    <h2>{item._id ? 'Edit Medicine' : 'Add New Medicine'}</h2>
                    <p className="inventory-form-subtext">
                      {item._id
                        ? `Update stock quantity, pricing, or details for "${item.medicine}".`
                        : `Enter medicine details and current available stock quantity for ${activeBranch?.name || 'this branch'}.`}
                    </p>
                  </div>
                  {item._id && (
                    <span className="editing-medicine-pill">
                      Editing: <strong>{item.medicine}</strong>
                    </span>
                  )}
                </div>

                {err && (
                  <div className="inventory-form-error" role="alert">
                    <span className="inventory-error-icon" aria-hidden="true">⚠</span>
                    <span>{err}</span>
                  </div>
                )}

                <form onSubmit={save} className="inventory-form-container">
                  <div className="inventory-form-field">
                    <label htmlFor="inv-med-name">
                      Medicine Name <span className="req-star">*</span>
                    </label>
                    <input
                      id="inv-med-name"
                      type="text"
                      value={item.medicine}
                      onChange={e => setItem({ ...item, medicine: e.target.value })}
                      placeholder="e.g. Paracetamol 500mg"
                      required
                      autoFocus
                    />
                    <span className="field-hint">Enter the full brand or trade name with dosage strength</span>
                  </div>

                  <div className="inventory-form-field">
                    <label htmlFor="inv-med-generic">
                      Generic / Chemical Name
                    </label>
                    <input
                      id="inv-med-generic"
                      type="text"
                      value={item.generic}
                      onChange={e => setItem({ ...item, generic: e.target.value })}
                      placeholder="e.g. Paracetamol"
                    />
                    <span className="field-hint">Active chemical compound for patient searches</span>
                  </div>

                  <div className="inventory-form-two-col">
                    <div className="inventory-form-field">
                      <label htmlFor="inv-med-qty">
                        Quantity in Stock <span className="req-star">*</span>
                      </label>
                      <input
                        id="inv-med-qty"
                        type="number"
                        min="0"
                        value={item.quantity}
                        onChange={e => setItem({ ...item, quantity: Number(e.target.value) })}
                        required
                      />
                      <span className="field-hint">Total available units/strips in stock</span>
                    </div>

                    <div className="inventory-form-field">
                      <label htmlFor="inv-med-price">
                        Price per tablet / unit (₹)
                      </label>
                      <input
                        id="inv-med-price"
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.price}
                        onChange={e => setItem({ ...item, price: e.target.value })}
                        placeholder="e.g. 2.00"
                      />
                      <span className="field-hint">Selling price in rupees per unit</span>
                    </div>
                  </div>

                  <div className="inventory-form-actions-bar">
                    <button
                      type="button"
                      className="btn-inventory-cancel"
                      onClick={handleCancelInventoryForm}
                      disabled={busy}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="btn-inventory-submit"
                      disabled={busy}
                    >
                      {busy ? 'Saving…' : item._id ? 'Update Medicine' : 'Add Medicine'}
                    </button>
                  </div>
                </form>
              </section>
            </main>
          ) : (
            <main className="content-wrap">
              <div className="stats">
                <div><strong>{stock.length}</strong><span>Medicines</span></div>
                <div><strong>{totalStock}</strong><span>Total units</span></div>
                <div
                  className="stat-reservations"
                  onClick={() => { setView('reservations'); load(); }}
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer' }}
                  title="Click to view reservations"
                >
                  <strong>{pending}</strong>
                  <span>Active reservations ↗</span>
                </div>
                <div><strong>{stock.filter(s => s.quantity > 0).length}</strong><span>In stock</span></div>
              </div>

              {inventorySuccessMsg && (
                <div className="inventory-success-alert" role="status">
                  <div className="inventory-success-content">
                    <span className="inventory-success-icon" aria-hidden="true">✓</span>
                    <span className="inventory-success-text">{inventorySuccessMsg}</span>
                  </div>
                  <button
                    type="button"
                    className="inventory-alert-close-btn"
                    onClick={() => setInventorySuccessMsg('')}
                    aria-label="Dismiss message"
                  >
                    ✕
                  </button>
                </div>
              )}

              {err && <p className="note">{err}</p>}

              <section className="panel inventory-panel">
                <div className="inventory-list-section">
                  <div className="inventory-list-header">
                    <div className="inventory-header-left">
                      <h3 className="inventory-section-title">Medicine Inventory</h3>
                      <span className="inventory-matches-count">
                        {stock.length === 0
                          ? '0 medicines'
                          : filteredStock.length === stock.length
                          ? `${stock.length} medicines total`
                          : `${filteredStock.length} of ${stock.length} medicines matching`}
                      </span>
                    </div>
                  </div>

                  <div className="medicine-actions-toolbar" role="toolbar" aria-label="Medicine actions toolbar">
                    <div className="inventory-search-box">
                      <svg className="inventory-search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      </svg>
                      <input
                        type="search"
                        className="inventory-search-input"
                        placeholder="Search by medicine or generic name..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        aria-label="Search by medicine or generic name"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          className="search-clear-btn"
                          onClick={() => setSearchQuery('')}
                          title="Clear search"
                          aria-label="Clear search"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      className="btn-add-medicine"
                      onClick={handleOpenAddMedicine}
                    >
                      <svg className="btn-add-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                      <span>+ Add Medicine</span>
                    </button>
                  </div>

                  <div className="inventory-filter-tabs" role="tablist" aria-label="Stock status filters">
                    <div className="filter-tabs-group">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={stockFilter === 'all'}
                        className={stockFilter === 'all' ? 'filter-tab-btn active' : 'filter-tab-btn'}
                        onClick={() => setStockFilter('all')}
                      >
                        All Medicines
                        <span className="filter-tab-count">{stock.length}</span>
                      </button>

                      <button
                        type="button"
                        role="tab"
                        aria-selected={stockFilter === 'in_stock'}
                        className={stockFilter === 'in_stock' ? 'filter-tab-btn active filter-in-stock' : 'filter-tab-btn filter-in-stock'}
                        onClick={() => setStockFilter('in_stock')}
                      >
                        In Stock
                        <span className="filter-tab-count">{inStockCount}</span>
                      </button>

                      <button
                        type="button"
                        role="tab"
                        aria-selected={stockFilter === 'low_stock'}
                        className={stockFilter === 'low_stock' ? 'filter-tab-btn active filter-low-stock' : 'filter-tab-btn filter-low-stock'}
                        onClick={() => setStockFilter('low_stock')}
                      >
                        Low Stock
                        <span className="filter-tab-count">{lowStockCount}</span>
                      </button>

                      <button
                        type="button"
                        role="tab"
                        aria-selected={stockFilter === 'out_of_stock'}
                        className={stockFilter === 'out_of_stock' ? 'filter-tab-btn active filter-out-of-stock' : 'filter-tab-btn filter-out-of-stock'}
                        onClick={() => setStockFilter('out_of_stock')}
                      >
                        Out of Stock
                        <span className="filter-tab-count">{outOfStockCount}</span>
                      </button>
                    </div>

                    {(searchQuery || stockFilter !== 'all') && (
                      <button
                        type="button"
                        className="reset-filters-link"
                        onClick={() => {
                          setSearchQuery('');
                          setStockFilter('all');
                        }}
                      >
                        Reset filters
                      </button>
                    )}
                  </div>

                  {loading ? (
                    <div className="loading-state-box">
                      <span className="loading-spinner" aria-hidden="true" />
                      <span>Loading inventory stock...</span>
                    </div>
                  ) : stock.length === 0 ? (
                    <div className="empty empty-state-box">
                      <div className="empty-state-icon" aria-hidden="true">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                        </svg>
                      </div>
                      <h3 className="empty-state-title">No medicines in inventory</h3>
                      <p className="empty-state-desc">
                        Your pharmacy inventory is currently empty. Click "Add Medicine" to register your first medicine and stock quantity.
                      </p>
                      <button
                        type="button"
                        className="btn-add-medicine btn-empty-add"
                        onClick={handleOpenAddMedicine}
                      >
                        + Add Medicine
                      </button>
                    </div>
                  ) : filteredStock.length === 0 ? (
                    <div className="empty empty-state-box">
                      <div className="empty-state-icon" aria-hidden="true">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                        </svg>
                      </div>
                      <h3 className="empty-state-title">No matching medicines found</h3>
                      <p className="empty-state-desc">
                        {searchQuery
                          ? `No medicines match "${searchQuery}" with the selected filter.`
                          : 'No medicines match the selected filter.'}
                      </p>
                      {(searchQuery || stockFilter !== 'all') && (
                        <button
                          type="button"
                          className="btn-clear-search-filter"
                          onClick={() => {
                            setSearchQuery('');
                            setStockFilter('all');
                          }}
                        >
                          Clear search & filters
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Medicine</th>
                            <th>Stock</th>
                            <th>Status</th>
                            <th>Price / tablet</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredStock.map(s => {
                            const status = getStockStatus(s.quantity);
                            const isOutOfStock = status === 'out_of_stock';
                            const isLowStock = status === 'low_stock';

                            return (
                              <tr key={s._id}>
                                <td>
                                  <span className="med-name-primary">{s.medicine}</span>
                                  <small>{s.generic || '—'}</small>
                                </td>
                                <td className={isOutOfStock ? 'low out-of-stock-text' : isLowStock ? 'low low-stock-text' : ''}>
                                  <strong>{s.quantity}</strong>
                                </td>
                                <td>
                                  <span className={`stock-badge ${isOutOfStock ? 'out-of-stock' : isLowStock ? 'low-stock' : 'in-stock'}`}>
                                    <span className="stock-badge-dot" />
                                    {isOutOfStock ? 'Out of Stock' : isLowStock ? 'Low Stock' : 'In Stock'}
                                  </span>
                                </td>
                                <td>
                                  ₹{s.price ?? '—'} / tablet
                                </td>
                                <td>
                                  <div className="stock-actions">
                                    <button
                                      type="button"
                                      className="btn-edit-stock"
                                      onClick={() => handleOpenEditMedicine(s)}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="delete-button"
                                      onClick={async () => {
                                        const confirmed = window.confirm(
                                          `Delete ${s.medicine}? This cannot be undone.`
                                        );
                                        if (!confirmed) return;
                                        try {
                                          setErr('');
                                          await api(`/pharmacy/stock/${s._id}`, {
                                            method: 'DELETE',
                                            token
                                          });
                                          if (item._id === s._id) {
                                            setItem(blank);
                                          }
                                          setInventorySuccessMsg(`Successfully deleted "${s.medicine}".`);
                                          setTimeout(() => setInventorySuccessMsg(''), 5000);
                                          await load(selectedBranchId);
                                        } catch (e) {
                                          setErr(e.message);
                                        }
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            </main>
          )}
        </>
      )}

      {view === 'reservations' && (
        <div className="reservations-page-container">
          {isOwner && (
            <div className="branch-top-nav-bar reservations-top-nav-bar">
              <button
                type="button"
                className="btn-back-branches"
                onClick={() => {
                  setView('branches');
                  loadBranches();
                }}
              >
                ← Back to Main Page
              </button>
            </div>
          )}
          <div className={`dashboard-head ${isOwner ? 'branch-dashboard-head' : ''} reservations-dashboard-head`}>
            <div>
              <p className="eyebrow">{isOwner ? 'PHARMACY OWNER DASHBOARD' : 'PATIENT RESERVATIONS'}</p>
              <h1>{activeBranch?.name ? `${activeBranch.name} Reservations` : 'Manage Medicine Requests'}</h1>
              {activeBranch && (
                <p className="branch-active-subtitle">
                  <span>📍 {activeBranch.address}</span>
                  {activeBranch.isMain && <span className="badge-main-branch">★ Main Branch</span>}
                  {activeBranch.phone && <span>• 📞 {activeBranch.phone}</span>}
                </p>
              )}
            </div>
            <div className="reservations-meta-stats">
              <span className="reservations-count-pill">
                <strong>{pending}</strong> active / {resv.length} total
              </span>
            </div>
          </div>
          <main className="content-wrap pharmacy-reservations-view">
            {err && <p className="note">{err}</p>}
            <section className="panel reservations-panel">
              <div className="panel-head reservations-panel-head">
                <div>
                  <h2>Incoming Patient Reservations</h2>
                  <p className="muted">Fulfill, ready, or cancel medicine hold requests in real time</p>
                </div>
              </div>

              {loading && (
                <div className="loading-state-box">
                  <span className="loading-spinner" aria-hidden="true" />
                  <span>Loading patient reservations...</span>
                </div>
              )}

              {!loading && resv.length === 0 && (
                <div className="empty empty-state-box">
                  <div className="empty-state-icon" aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
                      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                    </svg>
                  </div>
                  <h3 className="empty-state-title">No reservations received yet</h3>
                  <p className="empty-state-desc">
                    When patients reserve medicines from your inventory, their requests will appear here in real time.
                  </p>
                </div>
              )}

              {!loading && (
                <div className="reservations-list">
                  {resv.map(r => (
                  <article className="pharmacy-reservation-card" key={r._id}>
                    <div className="resv-main-info">
                      <div className="resv-title-row">
                        <h3 className="resv-medicine-name">{r.stock?.medicine || 'Medicine'}</h3>
                        <span className="resv-qty-badge">× {r.quantity} {r.quantity === 1 ? 'unit' : 'units'}</span>
                        <span className={`status ${r.status}`}>
                          {r.status}
                        </span>
                      </div>

                      <div className="resv-patient-info">
                        <div className="resv-meta-item">
                          <span className="meta-icon" aria-hidden="true">👤</span>
                          <span className="meta-label">Patient:</span>
                          <strong>{r.patientName}</strong>
                        </div>

                        {r.patientPhone && (
                          <div className="resv-meta-item">
                            <span className="meta-icon" aria-hidden="true">📞</span>
                            <span className="meta-label">Phone:</span>
                            <span>{r.patientPhone}</span>
                          </div>
                        )}

                        <div className="resv-meta-item">
                          <span className="meta-icon" aria-hidden="true">🕒</span>
                          <span className="meta-label">Requested:</span>
                          <span className="muted">{new Date(r.createdAt).toLocaleString()}</span>
                        </div>

                        {r.expiresAt && ['held', 'confirmed'].includes(r.status) && (
                          <div className="resv-meta-item">
                            <span className="meta-icon" aria-hidden="true">⏳</span>
                            <span className="meta-label">Hold Expires:</span>
                            <span className="muted">{new Date(r.expiresAt).toLocaleTimeString()}</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="resv-actions-wrap">
                      {r.status === 'held' && (
                        <button
                          type="button"
                          className="btn-status-action btn-confirm"
                          onClick={() => status(r._id, 'confirmed')}
                        >
                          Confirm Hold
                        </button>
                      )}

                      {r.status === 'confirmed' && (
                        <button
                          type="button"
                          className="btn-status-action btn-ready"
                          onClick={() => status(r._id, 'ready')}
                        >
                          Mark Ready for Pickup
                        </button>
                      )}

                      {r.status === 'ready' && (
                        <button
                          type="button"
                          className="btn-status-action btn-collected"
                          onClick={() => status(r._id, 'collected')}
                        >
                          Mark as Collected
                        </button>
                      )}

                      {['held', 'confirmed', 'ready'].includes(r.status) && (
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => status(r._id, 'cancelled')}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
              )}
            </section>
          </main>
        </div>
      )}

      {view === 'branches' && isOwner && (
        <>
          <div className="dashboard-head">
            <div>
              <p className="eyebrow">PHARMACY OWNER DASHBOARD</p>
              <h1>Pharmacy Branches Overview</h1>
              <p className="branch-active-subtitle">
                Select a branch to manage its live inventory, reservations, transfers, and branch profile.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div className="branches-total-pill">
                <span>Total Branches:</span>
                <strong>{branches.length}</strong>
              </div>
              <button
                type="button"
                className="btn-add-branch"
                onClick={() => {
                  setShowAddBranchModal(true);
                  setAddBranchForm({ name: '', phone: '', address: '' });
                  setAddBranchCoords(null);
                  setAddBranchErr('');
                  setAddBranchGeocodeMsg({ type: '', text: '' });
                  setAddBranchSuggestions([]);
                }}
              >
                + Add Branch
              </button>
            </div>
          </div>

          <main className="content-wrap branch-management-view">
            {branchSuccessMsg && (
              <div className="success-box" role="status">
                <span>✓</span>
                <span>{branchSuccessMsg}</span>
              </div>
            )}

            {branchListErr && <p className="note">{branchListErr}</p>}

            {loadingBranches ? (
              <div className="loading-state-box">
                <span className="loading-spinner" aria-hidden="true" />
                <span>Loading pharmacy branches...</span>
              </div>
            ) : branches.length === 0 ? (
              <div className="empty empty-state-box">
                <div className="empty-state-icon" aria-hidden="true">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </div>
                <h3 className="empty-state-title">No branches registered</h3>
                <p className="empty-state-desc">
                  You haven&apos;t added any secondary branches yet. Click &ldquo;+ Add Branch&rdquo; above to create one.
                </p>
              </div>
            ) : (
              <div className="branch-grid">
                {branches.map(b => {
                  const isSelected = selectedBranchId === b._id;
                  const coords = parseCoordinates(b.location);

                  return (
                    <article
                      key={b._id}
                      className={`branch-card clickable-branch-card ${isSelected ? 'is-active-branch' : ''}`}
                      onClick={(e) => {
                        if (e.target.closest('button') || e.target.closest('a')) return;
                        openBranchDashboard(b._id, 'dashboard');
                      }}
                    >
                      <div>
                        <div className="branch-card-header">
                          <h3 className="branch-card-title">{b.name}</h3>
                          <div className="branch-badges-group">
                            {b.isMain ? (
                              <span className="badge-main-branch">★ Main Branch</span>
                            ) : (
                              <span className="badge-secondary-branch">Secondary Branch</span>
                            )}
                            <span className={`badge-active-status ${b.isActive !== false ? 'active' : 'inactive'}`}>
                              {b.isActive !== false ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </div>

                        <div className="branch-card-body">
                          <div className="branch-info-row">
                            <span className="branch-info-icon" aria-hidden="true">📍</span>
                            <div className="branch-info-text">
                              <span>{b.address}</span>
                              {coords && (
                                <div>
                                  <a
                                    className="branch-maps-link"
                                    href={`https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    View on Google Maps ↗
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="branch-info-row">
                            <span className="branch-info-icon" aria-hidden="true">📞</span>
                            <span className="branch-info-text">{b.phone || 'No phone provided'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="branch-card-actions">
                        <button
                          type="button"
                          className="btn-select-branch"
                          onClick={(e) => {
                            e.stopPropagation();
                            openBranchDashboard(b._id, 'dashboard');
                          }}
                        >
                          Open Dashboard →
                        </button>

                        <button
                          type="button"
                          className="btn-edit-branch"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditBranchModal(b);
                          }}
                        >
                          Edit Branch
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </main>
        </>
      )}

      {view === 'transfers' && (
        <>
          {isOwner && (
            <div className="branch-top-nav-bar">
              <button
                type="button"
                className="btn-back-branches"
                onClick={() => {
                  setView('branches');
                  loadBranches();
                }}
              >
                ← Back to Main Page
              </button>
            </div>
          )}
          <div className={`dashboard-head ${isOwner ? 'branch-dashboard-head' : ''}`}>
            <div>
              <p className="eyebrow">{isOwner ? 'PHARMACY OWNER DASHBOARD' : 'INTER-BRANCH MEDICINE TRANSFERS'}</p>
              <h1>{activeBranch?.name ? `${activeBranch.name} Transfers` : 'Stock Transfer Requests'}</h1>
              {activeBranch && (
                <p className="branch-active-subtitle">
                  <span>📍 {activeBranch.address}</span>
                  {activeBranch.isMain && <span className="badge-main-branch">★ Main Branch</span>}
                  {activeBranch.phone && <span>• 📞 {activeBranch.phone}</span>}
                </p>
              )}
            </div>
            <div className="transfer-header-meta">
              <span className="reservations-count-pill">
                <strong>{pendingTransfersCount}</strong> pending / {transfers.length} total
              </span>
              {transferSubView === 'history' && (
                <button
                  type="button"
                  className="btn-new-transfer"
                  onClick={() => {
                    setTransferSubView('request');
                    setSelectedTransferCandidate(null);
                    setSubmitTransferErr('');
                    loadAvailableStock(searchTransferQuery);
                  }}
                >
                  <svg className="btn-add-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  <span>New Transfer</span>
                </button>
              )}
            </div>
          </div>

          <main className="content-wrap transfer-view">
            {transferSuccess && (
              <div className="success-box" role="status">
                <span>✓</span>
                <span>{transferSuccess}</span>
              </div>
            )}
            {transferErr && <p className="note">{transferErr}</p>}

            {transferSubView === 'request' ? (
              <>
                <div className="transfer-view-top-bar">
                  <button
                    type="button"
                    className="btn-back-to-transfers"
                    onClick={() => {
                      setTransferSubView('history');
                      setSelectedTransferCandidate(null);
                      setSubmitTransferErr('');
                    }}
                  >
                    ← Back to Transfers
                  </button>
                </div>

                {/* 1. Request Stock from Other Branch Panel */}
                <section className="transfer-card-box">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">NEW TRANSFER REQUEST</p>
                  <h2>Request Medicine from Another Branch</h2>
                  <p className="muted">
                    Search medicines available across other active branches of your pharmacy business
                  </p>
                </div>
              </div>

              {/* Medicine search across other branches */}
              <div className="transfer-search-container">
                <input
                  type="search"
                  className="transfer-search-input"
                  placeholder="Search medicine or generic name in other branches..."
                  value={searchTransferQuery}
                  onChange={e => {
                    const val = e.target.value;
                    setSearchTransferQuery(val);
                    loadAvailableStock(val);
                  }}
                  aria-label="Search available medicines across other branches"
                />
                <button
                  type="button"
                  className="btn-select-avail-med"
                  onClick={() => loadAvailableStock(searchTransferQuery)}
                  style={{ padding: '0 16px', fontSize: '0.9rem' }}
                >
                  Search
                </button>
              </div>

              {loadingAvailableStock ? (
                <div className="loading-state-box">
                  <span className="loading-spinner" aria-hidden="true" />
                  <span>Searching other branch inventories...</span>
                </div>
              ) : availableOtherStock.length === 0 ? (
                <div className="empty" style={{ padding: '20px', marginBottom: '16px' }}>
                  <p className="muted" style={{ margin: 0 }}>
                    {searchTransferQuery
                      ? `No medicines matching "${searchTransferQuery}" found in other active branches.`
                      : 'No available medicines found in other branches. Add branches or update inventory first.'}
                  </p>
                </div>
              ) : (
                <div className="available-stock-grid">
                  {availableOtherStock.map(item => {
                    const isSelected = selectedTransferCandidate?.stockId === item.stockId;
                    return (
                      <div
                        key={item.stockId}
                        className={`available-stock-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedTransferCandidate(item);
                          setTransferRequestQty(1);
                          setSubmitTransferErr('');
                        }}
                      >
                        <div className="available-stock-card-header">
                          <div>
                            <h4 className="avail-med-name">{item.medicine}</h4>
                            <span className="avail-generic-name">{item.generic || '—'}</span>
                          </div>
                          <span className="avail-branch-badge">
                            📍 {item.branch.name}
                          </span>
                        </div>

                        <div className="avail-stock-details">
                          <span className="avail-qty-text">
                            Available: <strong>{item.availableQuantity}</strong> units
                          </span>
                          {item.price != null && (
                            <span className="muted">₹{item.price} / unit</span>
                          )}
                          <button
                            type="button"
                            className="btn-select-avail-med"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTransferCandidate(item);
                              setTransferRequestQty(1);
                              setSubmitTransferErr('');
                            }}
                          >
                            {isSelected ? 'Selected' : 'Select'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Selected Candidate Transfer Order Form */}
              {selectedTransferCandidate && (
                <div className="transfer-form-card">
                  <div className="transfer-meta-preview">
                    <span>
                      Supplying Branch: <strong>{selectedTransferCandidate.branch.name}</strong>
                    </span>
                    <span className="transfer-flow-arrow">→</span>
                    <span>
                      Destination: <strong>{activeBranch?.name || auth.branch?.name || 'Selected Branch'}</strong>
                    </span>
                    <span>
                      Medicine: <strong style={{ color: 'var(--pine)' }}>{selectedTransferCandidate.medicine}</strong>
                    </span>
                    <span>
                      Max Available: <strong>{selectedTransferCandidate.availableQuantity}</strong> units
                    </span>
                  </div>

                  {submitTransferErr && (
                    <div className="error-box" style={{ marginBottom: '14px' }}>
                      {submitTransferErr}
                    </div>
                  )}

                  <form onSubmit={handleSubmitTransfer} className="transfer-form-grid">
                    <label>
                      Requested Quantity (units)
                      <input
                        type="number"
                        min="1"
                        max={selectedTransferCandidate.availableQuantity}
                        step="1"
                        value={transferRequestQty}
                        onChange={e => setTransferRequestQty(e.target.value)}
                        placeholder={`1 - ${selectedTransferCandidate.availableQuantity}`}
                        required
                        style={{ marginTop: '4px' }}
                      />
                    </label>

                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        type="submit"
                        className="btn-submit-transfer"
                        disabled={submittingTransfer}
                        style={{ flex: 1 }}
                      >
                        {submittingTransfer ? 'Submitting…' : 'Submit Transfer Request'}
                      </button>
                      <button
                        type="button"
                        className="btn-modal-cancel"
                        onClick={() => {
                          setSelectedTransferCandidate(null);
                          setTransferSubView('history');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </section>
          </>
        ) : (
          /* 2. Transfer Requests History Panel */
          <section className="transfer-card-box">
              <div className="panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px' }}>
                <div>
                  <p className="eyebrow">TRANSFER LOG</p>
                  <h2>Transfer Requests Lifecycle</h2>
                  <p className="muted">
                    {isOwner
                      ? 'Manage stock requests across your pharmacy network: approve, dispatch, and receive transfers.'
                      : `Transfer requests involving ${activeBranch?.name || 'your assigned branch'}.`}
                  </p>
                </div>

                {/* Direction filter for quick triage */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                  <div className="tabs" style={{ margin: 0 }}>
                    <button
                      type="button"
                      className={`tab ${transferDirectionFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setTransferDirectionFilter('all')}
                    >
                      All Transfers
                    </button>
                    <button
                      type="button"
                      className={`tab ${transferDirectionFilter === 'incoming' ? 'active' : ''}`}
                      onClick={() => setTransferDirectionFilter('incoming')}
                    >
                      📥 Incoming to My Branch
                    </button>
                    <button
                      type="button"
                      className={`tab ${transferDirectionFilter === 'outgoing' ? 'active' : ''}`}
                      onClick={() => setTransferDirectionFilter('outgoing')}
                    >
                      📤 Outgoing from My Branch
                    </button>
                  </div>
                </div>
              </div>

              {/* Status Tabs */}
              <div className="tabs" style={{ marginTop: '10px', marginBottom: '14px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className={`tab ${transferStatusFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setTransferStatusFilter('all')}
                >
                  All ({transfers.length})
                </button>
                <button
                  type="button"
                  className={`tab ${transferStatusFilter === 'pending' ? 'active' : ''}`}
                  onClick={() => setTransferStatusFilter('pending')}
                >
                  Pending ({transfers.filter(t => t.status === 'pending').length})
                </button>
                <button
                  type="button"
                  className={`tab ${transferStatusFilter === 'approved' ? 'active' : ''}`}
                  onClick={() => setTransferStatusFilter('approved')}
                >
                  Approved ({transfers.filter(t => t.status === 'approved').length})
                </button>
                <button
                  type="button"
                  className={`tab ${transferStatusFilter === 'dispatched' ? 'active' : ''}`}
                  onClick={() => setTransferStatusFilter('dispatched')}
                >
                  Dispatched ({transfers.filter(t => t.status === 'dispatched').length})
                </button>
                <button
                  type="button"
                  className={`tab ${transferStatusFilter === 'received' ? 'active' : ''}`}
                  onClick={() => setTransferStatusFilter('received')}
                >
                  Received ({transfers.filter(t => t.status === 'received').length})
                </button>
                <button
                  type="button"
                  className={`tab ${transferStatusFilter === 'closed' ? 'active' : ''}`}
                  onClick={() => setTransferStatusFilter('closed')}
                >
                  Closed ({transfers.filter(t => ['rejected', 'cancelled'].includes(t.status)).length})
                </button>
              </div>

              {loadingTransfers ? (
                <div className="loading-state-box">
                  <span className="loading-spinner" aria-hidden="true" />
                  <span>Loading transfer requests...</span>
                </div>
              ) : filteredTransfers.length === 0 ? (
                <div className="empty empty-state-box">
                  <div className="empty-state-icon" aria-hidden="true">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                    </svg>
                  </div>
                  <h3 className="empty-state-title">No transfer requests found</h3>
                  <p className="empty-state-desc">
                    {transferStatusFilter !== 'all' || transferDirectionFilter !== 'all'
                      ? 'No transfer requests match your active filters.'
                      : 'No medicine transfer requests have been created yet. Click "+ New Transfer" above to request stock.'}
                  </p>
                </div>
              ) : (
                <div className="table-wrap transfer-table-card">
                  <table>
                    <thead>
                      <tr>
                        <th>Medicine</th>
                        <th>Qty</th>
                        <th>Direction</th>
                        <th>Supplying Branch</th>
                        <th>Destination Branch</th>
                        <th>Requested By</th>
                        <th>Status</th>
                        <th>Date & Time</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransfers.map(t => {
                        const incoming = isIncomingTransfer(t);
                        const outgoing = isOutgoingTransfer(t);

                        return (
                          <tr key={t._id}>
                            <td>
                              <strong className="med-name-primary">{t.medicine}</strong>
                            </td>
                            <td>
                              <strong>{t.dispatchedQuantity || t.requestedQuantity}</strong> units
                            </td>
                            <td>
                              {incoming ? (
                                <span className="direction-badge incoming">📥 Incoming</span>
                              ) : outgoing ? (
                                <span className="direction-badge outgoing">📤 Outgoing</span>
                              ) : (
                                <span className="muted" style={{ fontSize: '0.8rem' }}>—</span>
                              )}
                            </td>
                            <td>
                              <span>📍 {t.fromBranch?.name || '—'}</span>
                              {t.fromBranch?.isMain && <small className="badge-main-branch" style={{ display: 'inline-block', marginLeft: '4px' }}>Main</small>}
                            </td>
                            <td>
                              <span>📍 {t.toBranch?.name || '—'}</span>
                              {t.toBranch?.isMain && <small className="badge-main-branch" style={{ display: 'inline-block', marginLeft: '4px' }}>Main</small>}
                            </td>
                            <td>
                              <span>{t.requestedBy?.name || '—'}</span>
                              <small>{t.requestedBy?.role === 'pharmacy' ? 'Owner' : 'Staff'}</small>
                            </td>
                            <td>
                              <span className={`status ${t.status}`}>
                                {t.status}
                              </span>
                            </td>
                            <td>
                              <span className="muted" style={{ fontSize: '0.82rem' }}>{new Date(t.createdAt).toLocaleString()}</span>
                            </td>
                            <td>
                              <div className="transfer-actions-cell">
                                {canApprove(t) && (
                                  <button
                                    type="button"
                                    className="btn-transfer-act btn-approve"
                                    disabled={actionBusy}
                                    onClick={() => handleTransferAction(t._id, 'approved')}
                                    title="Approve transfer request"
                                  >
                                    ✓ Approve
                                  </button>
                                )}

                                {canReject(t) && (
                                  <button
                                    type="button"
                                    className="btn-transfer-act btn-reject"
                                    disabled={actionBusy}
                                    onClick={() => {
                                      setActionReason('');
                                      setActionErr('');
                                      setConfirmModal({ transfer: t, action: 'reject' });
                                    }}
                                    title="Reject transfer request"
                                  >
                                    ✕ Reject
                                  </button>
                                )}

                                {canDispatch(t) && (
                                  <button
                                    type="button"
                                    className="btn-transfer-act btn-dispatch"
                                    disabled={actionBusy}
                                    onClick={() => {
                                      setActionErr('');
                                      setConfirmModal({ transfer: t, action: 'dispatch' });
                                    }}
                                    title="Dispatch medicine stock"
                                  >
                                    📦 Dispatch Stock
                                  </button>
                                )}

                                {canReceive(t) && (
                                  <button
                                    type="button"
                                    className="btn-transfer-act btn-receive"
                                    disabled={actionBusy}
                                    onClick={() => {
                                      setActionErr('');
                                      setConfirmModal({ transfer: t, action: 'receive' });
                                    }}
                                    title="Confirm stock receipt"
                                  >
                                    📥 Mark Received
                                  </button>
                                )}

                                {canCancel(t) && (
                                  <button
                                    type="button"
                                    className="btn-transfer-act btn-cancel"
                                    disabled={actionBusy}
                                    onClick={() => {
                                      setActionReason('');
                                      setActionErr('');
                                      setConfirmModal({ transfer: t, action: 'cancel' });
                                    }}
                                    title="Cancel transfer request"
                                  >
                                    Cancel
                                  </button>
                                )}

                                {!canApprove(t) && !canReject(t) && !canDispatch(t) && !canReceive(t) && !canCancel(t) && (
                                  <span className="muted" style={{ fontSize: '0.8rem' }}>None</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

            {/* Confirmation Dialog Modal for Dispatch, Receipt, Rejection, and Cancellation */}
            {confirmModal && (
              <div className="transfer-modal-backdrop" onClick={() => !actionBusy && setConfirmModal(null)}>
                <div className="transfer-modal-dialog" onClick={e => e.stopPropagation()}>
                  <div className="transfer-modal-header">
                    <h3>
                      {confirmModal.action === 'dispatch' && '📦 Confirm Stock Dispatch'}
                      {confirmModal.action === 'receive' && '📥 Confirm Stock Receipt'}
                      {confirmModal.action === 'reject' && '✕ Reject Transfer Request'}
                      {confirmModal.action === 'cancel' && '🚫 Cancel Transfer Request'}
                    </h3>
                    <button
                      type="button"
                      className="transfer-modal-close"
                      disabled={actionBusy}
                      onClick={() => setConfirmModal(null)}
                      aria-label="Close modal"
                    >
                      ×
                    </button>
                  </div>

                  <div className="transfer-modal-body">
                    {actionErr && <div className="error-box">{actionErr}</div>}

                    <div className="transfer-modal-summary-box">
                      <div className="transfer-summary-row">
                        <span className="transfer-summary-label">Medicine:</span>
                        <span className="transfer-summary-val">{confirmModal.transfer.medicine}</span>
                      </div>
                      <div className="transfer-summary-row">
                        <span className="transfer-summary-label">Quantity:</span>
                        <span className="transfer-summary-val">
                          {confirmModal.transfer.dispatchedQuantity || confirmModal.transfer.requestedQuantity} units
                        </span>
                      </div>
                      <div className="transfer-summary-row">
                        <span className="transfer-summary-label">Supplying Branch:</span>
                        <span className="transfer-summary-val">{confirmModal.transfer.fromBranch?.name}</span>
                      </div>
                      <div className="transfer-summary-row">
                        <span className="transfer-summary-label">Destination Branch:</span>
                        <span className="transfer-summary-val">{confirmModal.transfer.toBranch?.name}</span>
                      </div>
                    </div>

                    {(confirmModal.action === 'reject' || confirmModal.action === 'cancel') && (
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>Reason (Optional):</span>
                        <input
                          type="text"
                          value={actionReason}
                          onChange={e => setActionReason(e.target.value)}
                          placeholder="e.g. Stock reserved for local emergency, alternative supplier used..."
                          style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1' }}
                        />
                      </label>
                    )}
                  </div>

                  <div className="transfer-modal-footer">
                    <button
                      type="button"
                      className="btn-modal-cancel"
                      disabled={actionBusy}
                      onClick={() => setConfirmModal(null)}
                    >
                      Close
                    </button>

                    {confirmModal.action === 'dispatch' && (
                      <button
                        type="button"
                        className="btn-transfer-act btn-dispatch"
                        disabled={actionBusy}
                        onClick={() => handleTransferAction(confirmModal.transfer._id, 'dispatched')}
                      >
                        {actionBusy ? 'Dispatching...' : 'Confirm & Dispatch Stock'}
                      </button>
                    )}

                    {confirmModal.action === 'receive' && (
                      <button
                        type="button"
                        className="btn-transfer-act btn-receive"
                        disabled={actionBusy}
                        onClick={() => handleTransferAction(confirmModal.transfer._id, 'received')}
                      >
                        {actionBusy ? 'Receiving...' : 'Confirm & Add to Inventory'}
                      </button>
                    )}

                    {confirmModal.action === 'reject' && (
                      <button
                        type="button"
                        className="btn-transfer-act btn-reject"
                        disabled={actionBusy}
                        onClick={() => handleTransferAction(confirmModal.transfer._id, 'rejected', { reason: actionReason })}
                      >
                        {actionBusy ? 'Rejecting...' : 'Confirm Rejection'}
                      </button>
                    )}

                    {confirmModal.action === 'cancel' && (
                      <button
                        type="button"
                        className="btn-transfer-act btn-cancel"
                        disabled={actionBusy}
                        onClick={() => handleTransferAction(confirmModal.transfer._id, 'cancelled', { reason: actionReason })}
                      >
                        {actionBusy ? 'Cancelling...' : 'Confirm Cancellation'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </main>
        </>
      )}

      {view === 'staff-management' && isOwner && (
        <>
          <div className="branch-top-nav-bar">
            <button
              type="button"
              className="btn-back-branches"
              onClick={() => {
                setView('branches');
                loadBranches();
              }}
            >
              ← Back to Main Page
            </button>
          </div>
          <div className="dashboard-head branch-dashboard-head">
            <div>
              <p className="eyebrow">PHARMACY OWNER DASHBOARD</p>
              <h1>{activeBranch?.name ? `${activeBranch.name} Staff Management` : 'Staff Management'}</h1>
              {activeBranch && (
                <p className="branch-active-subtitle">
                  <span>📍 {activeBranch.address}</span>
                  {activeBranch.isMain && <span className="badge-main-branch">★ Main Branch</span>}
                  {activeBranch.phone && <span>• 📞 {activeBranch.phone}</span>}
                </p>
              )}
            </div>
            <div>
              <button
                type="button"
                className="btn-create-branch"
                onClick={() => {
                  setAddStaffErr('');
                  setBranchStaffSuccess('');
                  setAddStaffForm({ name: '', email: '', password: '', confirmPassword: '' });
                  setShowAddStaffModal(true);
                }}
              >
                + Add New Staff
              </button>
            </div>
          </div>

          <main className="content-wrap pharmacy-branch-profile-view">
            {activeBranch ? (
              <section className="profile-section-card">
                <div className="section-card-header">
                  <span className="section-icon" aria-hidden="true">👥</span>
                  <div>
                    <h2>Branch Staff Accounts</h2>
                    <p className="section-subtitle">Owner-managed credentials and authorization for {activeBranch.name}</p>
                  </div>
                </div>

                <div className="section-card-body">
                  {branchStaffSuccess && <div className="hint" style={{ color: 'var(--pine)', fontWeight: 600, marginBottom: '14px' }}>✓ {branchStaffSuccess}</div>}
                  {branchStaffErr && <div className="error-box" style={{ marginBottom: '14px' }}>{branchStaffErr}</div>}

                  {loadingBranchStaff ? (
                    <div className="loading-state-box">
                      <span className="loading-spinner" aria-hidden="true" />
                      <span>Loading branch staff...</span>
                    </div>
                  ) : branchStaffList.length === 0 ? (
                    <div className="empty empty-state-box">
                      <p className="empty-state-desc">No staff members added yet</p>
                    </div>
                  ) : (
                    <div className="staff-members-table-wrap" style={{ overflowX: 'auto' }}>
                      <table className="staff-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid var(--line)', color: 'var(--muted)' }}>
                            <th style={{ padding: '12px 14px' }}>Staff Full Name</th>
                            <th style={{ padding: '12px 14px' }}>Staff Email</th>
                            <th style={{ padding: '12px 14px' }}>Assigned Branch</th>
                            <th style={{ padding: '12px 14px' }}>Account Status</th>
                            <th style={{ padding: '12px 14px', textAlign: 'right' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {branchStaffList.map(s => {
                            const isActive = s.isActive !== false;
                            return (
                              <tr key={s._id} style={{ borderBottom: '1px solid var(--line)' }}>
                                <td style={{ padding: '14px', fontWeight: 700 }}>{s.name}</td>
                                <td style={{ padding: '14px' }}>{s.email}</td>
                                <td style={{ padding: '14px' }}>
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <span aria-hidden="true">📍</span>
                                    {activeBranch.name}
                                  </span>
                                </td>
                                <td style={{ padding: '14px' }}>
                                  <span className={`badge-active-status ${isActive ? 'active' : 'inactive'}`}>
                                    {isActive ? 'Active' : 'Inactive'}
                                  </span>
                                </td>
                                <td style={{ padding: '14px', textAlign: 'right' }}>
                                  <button
                                    type="button"
                                    className={`btn-table-action ${isActive ? 'btn-deactivate' : 'btn-activate'}`}
                                    style={{
                                      padding: '6px 14px',
                                      fontSize: '0.82rem',
                                      fontWeight: 600,
                                      borderRadius: '6px',
                                      border: '1px solid',
                                      cursor: 'pointer',
                                      background: isActive ? '#fff' : 'var(--pine, #10b981)',
                                      color: isActive ? 'var(--crimson, #ef4444)' : '#fff',
                                      borderColor: isActive ? 'var(--crimson, #ef4444)' : 'var(--pine, #10b981)'
                                    }}
                                    onClick={() => handleToggleStaffStatus(s)}
                                  >
                                    {isActive ? 'Deactivate' : 'Activate'}
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <div className="empty empty-state-box">
                <p>No branch selected. Please return to the branch list.</p>
              </div>
            )}
          </main>
        </>
      )}

      {view === 'branch-profile' && isOwner && (
        <>
          <div className="branch-top-nav-bar">
            <button
              type="button"
              className="btn-back-branches"
              onClick={() => {
                setView('branches');
                loadBranches();
              }}
            >
              ← Back to Main Page
            </button>
          </div>
          <div className="dashboard-head branch-dashboard-head">
            <div>
              <p className="eyebrow">PHARMACY OWNER DASHBOARD</p>
              <h1>{activeBranch?.name ? `${activeBranch.name} Profile` : 'Branch Details'}</h1>
              {activeBranch && (
                <p className="branch-active-subtitle">
                  <span>📍 {activeBranch.address}</span>
                  {activeBranch.isMain && <span className="badge-main-branch">★ Main Branch</span>}
                  {activeBranch.phone && <span>• 📞 {activeBranch.phone}</span>}
                </p>
              )}
            </div>
            <div>
              <button
                type="button"
                className="btn-edit-branch"
                onClick={() => activeBranch && openEditBranchModal(activeBranch)}
              >
                Edit Branch Details
              </button>
            </div>
          </div>

          <main className="content-wrap branch-profile-view">

            {activeBranch ? (
              <>
                <section className="profile-section-card">
                <div className="section-card-header">
                  <span className="section-icon" aria-hidden="true">🏥</span>
                  <div>
                    <h2>Branch Information</h2>
                    <p className="section-subtitle">Registered physical facility details for this branch</p>
                  </div>
                </div>

                <div className="section-card-body">
                  <div className="profile-rows-container">
                    <div className="profile-field-row">
                      <span className="profile-field-label">Branch Name:</span>
                      <span className="profile-field-value name-highlight">{activeBranch.name}</span>
                    </div>

                    <div className="profile-field-row">
                      <span className="profile-field-label">Branch Type:</span>
                      <span className="profile-field-value">
                        {activeBranch.isMain ? '★ Main Branch (Primary Headquarters)' : 'Secondary Branch'}
                      </span>
                    </div>

                    <div className="profile-field-row">
                      <span className="profile-field-label">Operating Status:</span>
                      <span className="profile-field-value">
                        <span className={`badge-active-status ${activeBranch.isActive !== false ? 'active' : 'inactive'}`}>
                          {activeBranch.isActive !== false ? 'Active & Open' : 'Inactive'}
                        </span>
                      </span>
                    </div>

                    <div className="profile-field-row">
                      <span className="profile-field-label">Contact Phone:</span>
                      <span className="profile-field-value">{activeBranch.phone || 'Not specified'}</span>
                    </div>

                    <div className="profile-field-row align-top">
                      <span className="profile-field-label">Branch Address:</span>
                      <div className="profile-field-value">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                          <span className="address-text">{activeBranch.address}</span>
                          <button
                            type="button"
                            className="edit-address-button"
                            onClick={() => openEditBranchModal(activeBranch)}
                          >
                            Edit Address
                          </button>
                        </div>
                      </div>
                    </div>

                    {activeBranch.location && parseCoordinates(activeBranch.location) && (
                      <div className="profile-field-row align-top">
                        <span className="profile-field-label">Location Mapping:</span>
                        <div className="profile-field-value">
                          <div className="map-integration-box">
                            <span className="coordinates-tag">
                              📍 {parseCoordinates(activeBranch.location).lat.toFixed(6)}° N, {parseCoordinates(activeBranch.location).lng.toFixed(6)}° E
                            </span>
                            <a
                              className="map-link-btn"
                              href={`https://www.google.com/maps/dir/?api=1&destination=${parseCoordinates(activeBranch.location).lat},${parseCoordinates(activeBranch.location).lng}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open in Google Maps ↗
                            </a>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              </>
            ) : (
              <div className="empty empty-state-box">
                <p>No branch selected. Please return to the branch list.</p>
              </div>
            )}
          </main>
        </>
      )}

      {view === 'activity-history' && isOwner && (
        <>
          <div className="branch-top-nav-bar">
            <button
              type="button"
              className="btn-back-branches"
              onClick={() => {
                setView('branches');
                loadBranches();
              }}
            >
              ← Back to Main Page
            </button>
          </div>

          <div className="dashboard-head branch-dashboard-head activity-dashboard-head">
            <div className="activity-head-info">
              <div className="activity-eyebrow-row">
                <span className="eyebrow activity-eyebrow">PHARMACY OWNER AUDIT TRAIL</span>
                {activeBranch?.isMain && <span className="branch-type-tag is-main">★ Main Branch</span>}
                {!activeBranch?.isMain && activeBranch && <span className="branch-type-tag is-branch">Standard Branch</span>}
              </div>
              <h1 className="activity-page-title">
                {activeBranch?.name ? activeBranch.name : 'Branch'}
                <span className="activity-title-sub"> — Activity History</span>
              </h1>
              {activeBranch && (
                <div className="activity-branch-meta">
                  <span className="meta-item">📍 {activeBranch.address || 'Address not registered'}</span>
                  {activeBranch.phone && (
                    <>
                      <span className="meta-sep">•</span>
                      <span className="meta-item">📞 {activeBranch.phone}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="activity-head-actions">
              {refreshSuccessNotice && (
                <span className="refresh-success-tag" role="status">
                  ✓ Refreshed
                </span>
              )}
              <button
                type="button"
                className={`btn-refresh-activity ${loadingActivityLogs ? 'is-loading' : ''}`}
                disabled={loadingActivityLogs}
                onClick={handleRefreshActivities}
                title="Refresh activities from server"
              >
                <span className={`refresh-icon ${loadingActivityLogs ? 'spinning' : ''}`}>↻</span>
                <span>{loadingActivityLogs ? 'Refreshing...' : 'Refresh History'}</span>
              </button>
            </div>
          </div>

          <main className="content-wrap activity-history-view">
            {activeBranch ? (
              <div className="activity-dashboard-container">
                {/* 1. Summary Cards (KPI Grid) */}
                <div className="activity-summary-grid">
                  <div
                    className={`activity-summary-card ${activityCategoryFilter === 'all' ? 'active-card' : ''}`}
                    onClick={() => setActivityCategoryFilter('all')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setActivityCategoryFilter('all')}
                    title="Click to view all activities"
                  >
                    <div className="summary-card-icon icon-total">📜</div>
                    <div className="summary-card-content">
                      <span className="summary-card-value">{categoryCounts.all}</span>
                      <span className="summary-card-label">Total Activities</span>
                    </div>
                  </div>

                  <div
                    className={`activity-summary-card ${activityCategoryFilter === 'inventory' ? 'active-card' : ''}`}
                    onClick={() => setActivityCategoryFilter(prev => prev === 'inventory' ? 'all' : 'inventory')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setActivityCategoryFilter(prev => prev === 'inventory' ? 'all' : 'inventory')}
                    title="Click to filter inventory changes"
                  >
                    <div className="summary-card-icon icon-inventory">📦</div>
                    <div className="summary-card-content">
                      <span className="summary-card-value">{categoryCounts.inventory}</span>
                      <span className="summary-card-label">Inventory Changes</span>
                    </div>
                  </div>

                  <div
                    className={`activity-summary-card ${activityCategoryFilter === 'reservations' ? 'active-card' : ''}`}
                    onClick={() => setActivityCategoryFilter(prev => prev === 'reservations' ? 'all' : 'reservations')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setActivityCategoryFilter(prev => prev === 'reservations' ? 'all' : 'reservations')}
                    title="Click to filter reservation activities"
                  >
                    <div className="summary-card-icon icon-reservations">📑</div>
                    <div className="summary-card-content">
                      <span className="summary-card-value">{categoryCounts.reservations}</span>
                      <span className="summary-card-label">Reservation Events</span>
                    </div>
                  </div>

                  <div
                    className={`activity-summary-card ${activityCategoryFilter === 'transfers' ? 'active-card' : ''}`}
                    onClick={() => setActivityCategoryFilter(prev => prev === 'transfers' ? 'all' : 'transfers')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setActivityCategoryFilter(prev => prev === 'transfers' ? 'all' : 'transfers')}
                    title="Click to filter transfer activities"
                  >
                    <div className="summary-card-icon icon-transfers">🔄</div>
                    <div className="summary-card-content">
                      <span className="summary-card-value">{categoryCounts.transfers}</span>
                      <span className="summary-card-label">Transfer Activities</span>
                    </div>
                  </div>
                </div>

                {/* 2. Compact Filter Toolbar */}
                <div className="activity-toolbar-card">
                  <div className="activity-search-field">
                    <span className="search-icon" aria-hidden="true">🔍</span>
                    <input
                      type="text"
                      className="activity-search-input"
                      placeholder="Search by medicine, staff, action, or keywords..."
                      value={activitySearchQuery}
                      onChange={(e) => setActivitySearchQuery(e.target.value)}
                    />
                    {activitySearchQuery && (
                      <button
                        type="button"
                        className="btn-clear-search"
                        onClick={() => setActivitySearchQuery('')}
                        title="Clear search query"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="activity-filters-cluster">
                    <div className="activity-filter-select-wrap">
                      <select
                        id="actCategoryFilter"
                        className="activity-toolbar-select"
                        value={activityCategoryFilter}
                        onChange={(e) => setActivityCategoryFilter(e.target.value)}
                        aria-label="Filter by category"
                      >
                        <option value="all">All Categories ({categoryCounts.all})</option>
                        <option value="inventory">📦 Inventory ({categoryCounts.inventory})</option>
                        <option value="reservations">📑 Reservations ({categoryCounts.reservations})</option>
                        <option value="transfers">🔄 Transfers ({categoryCounts.transfers})</option>
                      </select>
                    </div>

                    <div className="activity-filter-select-wrap">
                      <select
                        id="actActorFilter"
                        className="activity-toolbar-select"
                        value={activityActorFilter}
                        onChange={(e) => setActivityActorFilter(e.target.value)}
                        aria-label="Filter by actor"
                      >
                        <option value="all">👥 Everyone</option>
                        <option value="owner">👑 Owner</option>
                        <option value="staff">👤 Staff</option>
                      </select>
                    </div>

                    <div className="activity-filter-select-wrap">
                      <select
                        id="actDateFilter"
                        className="activity-toolbar-select"
                        value={activityDateFilter}
                        onChange={(e) => setActivityDateFilter(e.target.value)}
                        aria-label="Filter by timeframe"
                      >
                        <option value="all">🕒 All Time</option>
                        <option value="today">📅 Today</option>
                        <option value="7days">📅 Last 7 Days</option>
                        <option value="30days">📅 Last 30 Days</option>
                      </select>
                    </div>

                    {hasActiveActivityFilters && (
                      <button
                        type="button"
                        className="btn-clear-all-filters"
                        onClick={handleClearActivityFilters}
                        title="Reset all search and filters"
                      >
                        ✕ Clear Filters
                      </button>
                    )}
                  </div>
                </div>

                {/* Error Box */}
                {activityLogsErr && (
                  <div className="error-box" style={{ marginBottom: '12px' }}>
                    <p>{activityLogsErr}</p>
                    <button
                      type="button"
                      className="btn-retry-activity"
                      onClick={() => activeBranch?._id && resetAndLoadActivityLogs(activeBranch._id)}
                    >
                      Try Again
                    </button>
                  </div>
                )}

                {/* Loading State */}
                {loadingActivityLogs && activityLogs.length === 0 && (
                  <div className="activity-loading-state">
                    <div className="spinner"></div>
                    <p>Loading activity audit records for {activeBranch.name}...</p>
                  </div>
                )}

                {/* 3. Audit Records Card Container */}
                <div className="activity-audit-card">
                  <div className="activity-audit-header">
                    <div className="activity-audit-count">
                      <span className="audit-header-title">Audit Records</span>
                      <span className="activity-count-badge">
                        Showing <strong>{filteredActivityLogs.length}</strong> of <strong>{activityLogs.length}</strong>
                      </span>
                      {hasActiveActivityFilters && (
                        <span className="filtered-tag">Filtered</span>
                      )}
                    </div>

                    {filteredActivityLogs.length > 0 && (
                      <div className="activity-expand-controls">
                        <button
                          type="button"
                          className="btn-toggle-all-details"
                          onClick={expandAllActivities}
                        >
                          Expand All Details
                        </button>
                        <span className="divider">•</span>
                        <button
                          type="button"
                          className="btn-toggle-all-details"
                          onClick={collapseAllActivities}
                        >
                          Collapse All
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Empty State: 0 total records */}
                  {!loadingActivityLogs && activityLogs.length === 0 && !activityLogsErr && (
                    <div className="empty empty-state-box activity-empty-box">
                      <div className="empty-icon">📜</div>
                      <h3>No activities recorded for this branch yet</h3>
                      <p className="empty-subtext">
                        Actions performed on medicine inventory, reservations, and inter-branch stock transfers for {activeBranch.name} will be logged here automatically.
                      </p>
                    </div>
                  )}

                  {/* Empty State: Filters returned 0 */}
                  {!loadingActivityLogs && activityLogs.length > 0 && filteredActivityLogs.length === 0 && (
                    <div className="empty empty-state-box activity-empty-box">
                      <div className="empty-icon">🔍</div>
                      <h3>No activities match your filters</h3>
                      <p className="empty-subtext">
                        Try adjusting your search terms, category, actor, or timeframe filters.
                      </p>
                      <button
                        type="button"
                        className="btn-reset-filters-hero"
                        onClick={handleClearActivityFilters}
                      >
                        Reset All Filters
                      </button>
                    </div>
                  )}

                  {/* Audit Rows List */}
                  {filteredActivityLogs.length > 0 && (
                    <div className="activity-audit-list">
                      {filteredActivityLogs.map((log) => {
                        const meta = getActivityActionMeta(log.actionType);
                        const isOwnerActor = log.actor?.actorType === 'Owner' || log.actor?.role === 'pharmacy';
                        const details = log.details || {};
                        const formattedTime = formatActivityTime(log.createdAt);
                        const isExpanded = Boolean(expandedActivityIds[log._id]);

                        return (
                          <div key={log._id} className={`activity-audit-row ${isExpanded ? 'is-expanded' : ''}`}>
                            <div className="activity-row-main">
                              {/* Action Type Badge with Icon */}
                              <div className={`activity-type-badge ${meta.badgeClass}`} title={meta.label}>
                                <span className="type-icon">{meta.icon}</span>
                                <span className="type-label">{meta.label}</span>
                              </div>

                              {/* Row Content Body */}
                              <div className="activity-row-body">
                                <div className="activity-row-desc">
                                  <span className="activity-desc-text">{log.description}</span>
                                </div>

                                {/* Contextual Chips Strip */}
                                <div className="activity-chips-strip">
                                  {details.medicine && (
                                    <span className="audit-chip chip-medicine" title="Affected Medicine">
                                      💊 {details.medicine}
                                    </span>
                                  )}

                                  {details.before?.quantity !== undefined && details.after?.quantity !== undefined && (
                                    <span className="audit-chip chip-diff" title="Quantity Change">
                                      📊 Stock: <strong className="diff-old">{details.before.quantity}</strong> → <strong className="diff-new">{details.after.quantity}</strong> units
                                    </span>
                                  )}

                                  {details.before?.quantity === undefined && details.quantity !== undefined && (
                                    <span className="audit-chip chip-qty" title="Quantity">
                                      📦 Qty: <strong>{details.quantity}</strong> units
                                    </span>
                                  )}

                                  {details.dispatchedQuantity !== undefined && (
                                    <span className="audit-chip chip-qty" title="Dispatched Quantity">
                                      🚚 Dispatched: <strong>{details.dispatchedQuantity}</strong> units
                                    </span>
                                  )}

                                  {details.status && (
                                    <span className="audit-chip chip-status" title="Status">
                                      🏷️ Status: <strong>{details.status}</strong>
                                    </span>
                                  )}

                                  {details.patientName && (
                                    <span className="audit-chip chip-patient" title="Patient Name">
                                      🧑‍🦱 Patient: <strong>{details.patientName}</strong>
                                    </span>
                                  )}

                                  {details.supplyingBranch && details.receivingBranch && (
                                    <span className="audit-chip chip-route" title="Transfer Route">
                                      🔄 {details.supplyingBranchName || details.supplyingBranch?.name || 'Branch'} → {details.receivingBranchName || details.receivingBranch?.name || 'Branch'}
                                    </span>
                                  )}

                                  {details.reason && (
                                    <span className="audit-chip chip-reason" title="Reason">
                                      💬 "{details.reason}"
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Actor, Timestamp & Expand Action */}
                              <div className="activity-row-meta">
                                <span className={`actor-badge ${isOwnerActor ? 'actor-owner' : 'actor-staff'}`}>
                                  {isOwnerActor ? '👑' : '👤'} {log.actor?.displayName || (isOwnerActor ? 'Owner' : 'Staff')}
                                  <span className="actor-role-note">({isOwnerActor ? 'Owner' : 'Staff'})</span>
                                </span>

                                <time className="audit-time" dateTime={log.createdAt} title={new Date(log.createdAt).toISOString()}>
                                  🕒 {formattedTime}
                                </time>

                                <button
                                  type="button"
                                  className="btn-toggle-row-drawer"
                                  onClick={() => toggleExpandActivity(log._id)}
                                  aria-expanded={isExpanded}
                                >
                                  {isExpanded ? 'Details ▴' : 'Details ▾'}
                                </button>
                              </div>
                            </div>

                            {/* Expandable Audit Details Drawer */}
                            {isExpanded && (
                              <div className="activity-row-drawer">
                                <div className="drawer-grid">
                                  <div className="drawer-item">
                                    <span className="drawer-label">Record ID</span>
                                    <code className="drawer-code">{log._id}</code>
                                  </div>
                                  <div className="drawer-item">
                                    <span className="drawer-label">Target Entity</span>
                                    <span className="drawer-value">{log.targetEntityType} ({log.targetEntityId || 'N/A'})</span>
                                  </div>
                                  <div className="drawer-item">
                                    <span className="drawer-label">Actor ID &amp; Type</span>
                                    <span className="drawer-value">{log.actor?.userId || 'N/A'} • {log.actor?.actorType || 'Owner'}</span>
                                  </div>
                                  <div className="drawer-item">
                                    <span className="drawer-label">UTC Timestamp</span>
                                    <span className="drawer-value">{new Date(log.createdAt).toISOString()}</span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* 4. Pagination Section */}
                {activityLogs.length > 0 && (
                  <div className="activity-pagination-footer">
                    {hasMoreActivities ? (
                      <button
                        type="button"
                        className="btn-load-more-activity"
                        disabled={loadingMoreActivities}
                        onClick={() => loadActivityLogs(activeBranch._id, activitySkip, true)}
                      >
                        {loadingMoreActivities ? 'Loading Older Activities...' : 'Load More Activities ↓'}
                      </button>
                    ) : (
                      <div className="all-activities-loaded-badge">
                        ✓ All {activityLogs.length} activity records loaded for {activeBranch.name}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="empty empty-state-box">
                <p>No branch selected. Please return to the branch overview.</p>
              </div>
            )}
          </main>
        </>
      )}

{view === 'profile' && (
  <main className="content-wrap pharmacy-profile-view">
    <div className="profile-page-nav">
      <button
        type="button"
        className="back-button"
        onClick={() => {
          const returnView = isOwner ? (previousOwnerView || 'branches') : 'dashboard';
          setView(returnView);
          if (returnView === 'reservations') {
            load();
          } else if (returnView === 'transfers') {
            setTransferSubView('history');
            loadTransfers();
            loadAvailableStock();
          } else if (returnView === 'staff-management') {
            if (activeBranch?._id) loadBranchStaff(activeBranch._id);
          } else if (returnView === 'activity-history') {
            if (activeBranch?._id) resetAndLoadActivityLogs(activeBranch._id);
          } else if (returnView === 'dashboard') {
            load();
          } else if (returnView === 'branches') {
            loadBranches();
          }
        }}
      >
        ← Back to Dashboard
      </button>
      <span className="profile-breadcrumb">
        {isOwner ? 'Pharmacy Portal / Owner Profile' : 'Pharmacy Portal / Account Profile'}
      </span>
    </div>

    {err && <p className="note">{err}</p>}

    {isOwner ? (
      <div className="owner-unified-profile-container">
        {/* Section 1: Owner Profile Header */}
        <section className="owner-profile-header-card">
          <div className="owner-avatar-wrap">
            <span className="owner-hero-avatar">
              {(profile?.ownerName || profile?.name || auth.name || 'O').trim().charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="owner-header-meta">
            <div className="owner-badge-row">
              <span className="owner-account-badge">
                <span className="badge-status-dot" aria-hidden="true"></span>
                Pharmacy Owner Account
              </span>
            </div>
            <h1 className="owner-header-title">
              {profile?.ownerName && profile.ownerName.trim() ? profile.ownerName.trim() : (profile?.name || auth.name)}
            </h1>
            <p className="owner-header-subtitle">
              {profile?.name ? `Owner & Administrator of ${profile.name}` : 'Pharmacy Owner'}
              {profile?.createdAt && ` • Registered since ${new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
            </p>
          </div>
        </section>

        {/* Section 2: Owner & Account Details */}
        <section className="owner-profile-section-card">
          <div className="owner-card-header">
            <span className="owner-section-icon" aria-hidden="true">👤</span>
            <div>
              <h2>Owner &amp; Account Details</h2>
              <p className="owner-section-subtitle">Authenticated pharmacy owner profile and business credentials</p>
            </div>
          </div>

          <div className="profile-rows-container">
            <div className="profile-field-row">
              <span className="profile-field-label">Owner Name:</span>
              <span className="profile-field-value">
                {profile?.ownerName && profile.ownerName.trim() ? (
                  <strong>{profile.ownerName.trim()}</strong>
                ) : (
                  <span className="muted" style={{ fontStyle: 'italic' }}>Not provided</span>
                )}
              </span>
            </div>

            <div className="profile-field-row">
              <span className="profile-field-label">Pharmacy Name:</span>
              <span className="profile-field-value name-highlight">
                {profile?.name || auth.name || 'Not specified'}
              </span>
            </div>

            <div className="profile-field-row">
              <span className="profile-field-label">Account Role:</span>
              <span className="profile-field-value">
                <span className="owner-role-tag">Pharmacy Owner &amp; Administrator</span>
              </span>
            </div>

            <div className="profile-field-row">
              <span className="profile-field-label">Email Address:</span>
              <span className="profile-field-value contact-value">
                <span className="field-icon" aria-hidden="true">✉️</span>
                {profile?.email || auth.email || 'Not specified'}
              </span>
            </div>

            <div className="profile-field-row">
              <span className="profile-field-label">Contact Phone:</span>
              <span className="profile-field-value contact-value">
                <span className="field-icon" aria-hidden="true">📞</span>
                {profile?.phone && profile.phone.trim() ? (
                  profile.phone.trim()
                ) : (
                  <span className="muted" style={{ fontStyle: 'italic' }}>Not provided</span>
                )}
              </span>
            </div>

            <div className="profile-field-row">
              <span className="profile-field-label">Total Branches:</span>
              <span className="profile-field-value">
                <strong>{branches.length}</strong> {branches.length === 1 ? 'branch location' : 'branch locations'}
              </span>
            </div>
          </div>
        </section>

        {/* Section 3: My Pharmacy Branches */}
        <section className="owner-profile-section-card">
          <div className="owner-card-header">
            <span className="owner-section-icon" aria-hidden="true">🏥</span>
            <div>
              <h2>My Pharmacy Branches</h2>
              <p className="owner-section-subtitle">
                All registered branch locations belonging to this pharmacy business
              </p>
            </div>
            <span className="branches-total-pill" style={{ marginLeft: 'auto' }}>
              <span>Total Branches:</span>
              <strong>{branches.length}</strong>
            </span>
          </div>

          <div className="owner-branches-body">
            {loadingBranches ? (
              <div className="loading-state-box">
                <span className="loading-spinner" aria-hidden="true" />
                <span>Loading registered branches...</span>
              </div>
            ) : branchListErr ? (
              <p className="note">{branchListErr}</p>
            ) : branches.length === 0 ? (
              <div className="empty empty-state-box">
                <p className="empty-state-desc">No branches registered yet.</p>
              </div>
            ) : (
              <div className="owner-branches-list">
                {branches.map(b => {
                  const coords = parseCoordinates(b.location);
                  return (
                    <div key={b._id} className="owner-branch-row">
                      <div className="owner-branch-row-top">
                        <div className="owner-branch-title-wrap">
                          <span className="branch-icon" aria-hidden="true">📍</span>
                          <h3 className="owner-branch-name">{b.name}</h3>
                        </div>
                        <div className="branch-badges-group">
                          {b.isMain ? (
                            <span className="badge-main-branch">★ Main Branch</span>
                          ) : (
                            <span className="badge-secondary-branch">Secondary Branch</span>
                          )}
                          <span className={`badge-active-status ${b.isActive !== false ? 'active' : 'inactive'}`}>
                            {b.isActive !== false ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </div>

                      <div className="owner-branch-row-details">
                        <div className="owner-branch-detail-item address-item">
                          <span className="detail-label">Address:</span>
                          <span className="detail-value">{b.address || 'Address not specified'}</span>
                        </div>

                        <div className="owner-branch-detail-item phone-item">
                          <span className="detail-label">Phone:</span>
                          <span className="detail-value">
                            {b.phone && b.phone.trim() ? (
                              `📞 ${b.phone.trim()}`
                            ) : (
                              <span className="muted" style={{ fontStyle: 'italic' }}>Not provided</span>
                            )}
                          </span>
                        </div>

                        <div className="owner-branch-detail-item map-item">
                          <span className="detail-label">Location:</span>
                          <div className="detail-value map-wrap">
                            {coords ? (
                              <>
                                <span className="coords-text">
                                  {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
                                </span>
                                <a
                                  className="owner-map-link"
                                  href={`https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View on Google Maps ↗
                                </a>
                              </>
                            ) : (
                              <span className="muted" style={{ fontStyle: 'italic' }}>Coordinates not available</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    ) : (
      <div className="staff-unified-profile-wrap">
        <div className="staff-unified-profile-card">
          {/* Top Heading & Account Summary Banner */}
          <div className="staff-profile-banner">
            <div className="hero-avatar-wrap">
              <span className="pharmacy-hero-avatar">
                {(profile?.staff?.name || auth.name || 'S').trim().charAt(0).toUpperCase()}
              </span>
            </div>

            <div className="hero-meta-wrap">
              <span className="pharmacy-account-badge">
                <span className="badge-status-dot" aria-hidden="true"></span>
                Branch Staff Account
              </span>
              <h1 className="pharmacy-hero-title">{profile?.staff?.name || auth.name}</h1>
              <p className="pharmacy-hero-subtitle">
                Staff Member • Assigned to {profile?.branch?.name || auth.branch?.name || 'Branch'}
                {profile?.staff?.createdAt && ` • Active since ${new Date(profile.staff.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}
              </p>
            </div>
          </div>

          {/* Section 1 — Pharmacy Owner Information */}
          <section className="staff-profile-section-block">
            <div className="staff-profile-section-header">
              <span className="section-icon" aria-hidden="true">🏥</span>
              <div>
                <h2>Pharmacy Owner Information</h2>
                <p className="section-subtitle">Parent pharmacy business and administrator details</p>
              </div>
            </div>

            <div className="profile-rows-container">
              <div className="profile-field-row">
                <span className="profile-field-label">Pharmacy Name:</span>
                <span className="profile-field-value name-highlight">
                  {profile?.pharmacy?.name || profile?.name || '—'}
                </span>
              </div>

              <div className="profile-field-row">
                <span className="profile-field-label">Owner Name:</span>
                <span className="profile-field-value">
                  {profile?.pharmacy?.ownerName || profile?.ownerName || 'Not specified'}
                </span>
              </div>

              <div className="profile-field-row">
                <span className="profile-field-label">Owner Email:</span>
                <span className="profile-field-value contact-value">
                  <span className="field-icon" aria-hidden="true">✉️</span>
                  {profile?.pharmacy?.email || profile?.email || '—'}
                </span>
              </div>

              <div className="profile-field-row">
                <span className="profile-field-label">Contact Phone:</span>
                <span className="profile-field-value contact-value">
                  <span className="field-icon" aria-hidden="true">📞</span>
                  {profile?.pharmacy?.phone || profile?.phone || 'Not provided'}
                </span>
              </div>

              <div className="profile-field-row align-top">
                <span className="profile-field-label">Headquarters Address:</span>
                <span className="profile-field-value address-text">
                  {profile?.pharmacy?.address || '—'}
                </span>
              </div>
            </div>
          </section>

          <hr className="staff-section-divider" />

          {/* Section 2 — Staff Account Information */}
          <section className="staff-profile-section-block">
            <div className="staff-profile-section-header">
              <span className="section-icon" aria-hidden="true">👤</span>
              <div>
                <h2>Staff Account Information</h2>
                <p className="section-subtitle">Your credentials and authorization in PharmaTrack</p>
              </div>
            </div>

            <div className="profile-rows-container">
              <div className="profile-field-row">
                <span className="profile-field-label">Staff Name:</span>
                <span className="profile-field-value">
                  <strong>{profile?.staff?.name || auth.name}</strong>
                </span>
              </div>

              <div className="profile-field-row">
                <span className="profile-field-label">Staff Email:</span>
                <span className="profile-field-value contact-value">
                  <span className="field-icon" aria-hidden="true">✉️</span>
                  {profile?.staff?.email || auth.email}
                </span>
              </div>

              <div className="profile-field-row">
                <span className="profile-field-label">Account Role:</span>
                <span className="profile-field-value">
                  <span className="role-tag">Branch Staff Member</span>
                </span>
              </div>

              <div className="profile-field-row">
                <span className="profile-field-label">Account Status:</span>
                <span className="profile-field-value">
                  <span className="status-live-tag">
                    <span className="status-dot-active" aria-hidden="true"></span>
                    Active &amp; Verified
                  </span>
                </span>
              </div>

              <div className="profile-field-row">
                <span className="profile-field-label">Assigned Branch:</span>
                <span className="profile-field-value">
                  {profile?.branch?.name || auth.branch?.name || '—'}
                </span>
              </div>

              <div className="profile-field-row">
                <span className="profile-field-label">Account Created:</span>
                <span className="profile-field-value">
                  {profile?.staff?.createdAt
                    ? new Date(profile.staff.createdAt).toLocaleDateString('en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric'
                      })
                    : '—'}
                </span>
              </div>
            </div>
          </section>

          <hr className="staff-section-divider" />

          {/* Section 3 — Assigned Branch Details */}
          <section className="staff-profile-section-block">
            <div className="staff-profile-section-header">
              <span className="section-icon" aria-hidden="true">📍</span>
              <div>
                <h2>Assigned Branch Details</h2>
                <p className="section-subtitle">Physical pharmacy facility where you are stationed</p>
              </div>
            </div>

            <div className="profile-rows-container">
              <div className="profile-field-row">
                <span className="profile-field-label">Branch Name:</span>
                <span className="profile-field-value name-highlight">
                  {profile?.branch?.name || auth.branch?.name || '—'}
                </span>
              </div>

              <div className="profile-field-row">
                <span className="profile-field-label">Branch Type:</span>
                <span className="profile-field-value">
                  {(profile?.branch?.isMain ?? auth.branch?.isMain) ? '★ Main Branch' : 'Secondary Branch'}
                </span>
              </div>

              <div className="profile-field-row">
                <span className="profile-field-label">Operating Status:</span>
                <span className="profile-field-value">
                  <span className="badge-active-status active">Active &amp; Open</span>
                </span>
              </div>

              <div className="profile-field-row">
                <span className="profile-field-label">Branch Phone:</span>
                <span className="profile-field-value contact-value">
                  <span className="field-icon" aria-hidden="true">📞</span>
                  {profile?.branch?.phone || 'Not provided'}
                </span>
              </div>

              <div className="profile-field-row align-top">
                <span className="profile-field-label">Branch Address:</span>
                <span className="profile-field-value address-text">
                  {profile?.branch?.address || auth.branch?.address || '—'}
                </span>
              </div>

              {profile?.branch?.location && parseCoordinates(profile.branch.location) && (
                <div className="profile-field-row align-top">
                  <span className="profile-field-label">Location Mapping:</span>
                  <div className="profile-field-value">
                    <div className="map-integration-box">
                      <span className="coordinates-tag">
                        📍 {parseCoordinates(profile.branch.location).lat.toFixed(6)}° N, {parseCoordinates(profile.branch.location).lng.toFixed(6)}° E
                      </span>
                      <a
                        className="map-link-btn"
                        href={`https://www.google.com/maps/dir/?api=1&destination=${parseCoordinates(profile.branch.location).lat},${parseCoordinates(profile.branch.location).lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open in Google Maps ↗
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    )}
  </main>
)}

      {/* Add Branch Modal */}
      {showAddBranchModal && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setShowAddBranchModal(false); }}>
          <div className="branch-modal-card">
            <button
              type="button"
              className="close"
              onClick={() => setShowAddBranchModal(false)}
              aria-label="Close add branch modal"
            >
              ×
            </button>
            <div className="branch-modal-header">
              <p className="eyebrow">NEW BRANCH</p>
              <h2>Add Pharmacy Branch</h2>
              <p>Register a new physical dispensary location for your pharmacy business</p>
            </div>

            {addBranchErr && <div className="error-box" style={{ marginBottom: '14px' }}>{addBranchErr}</div>}

            <form onSubmit={handleAddBranchSubmit} className="form-grid">
              <label>
                Branch Name
                <input
                  type="text"
                  value={addBranchForm.name}
                  onChange={e => setAddBranchForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="e.g., PharmaTrack - Porur Branch"
                  required
                />
              </label>

              <label>
                Phone Number
                <input
                  type="text"
                  value={addBranchForm.phone}
                  onChange={e => setAddBranchForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="e.g., +91 98765 43210"
                />
              </label>

              <label>
                Branch Address
                <div className="address-input-row" style={{ marginTop: '4px' }}>
                  <input
                    type="text"
                    value={addBranchForm.address}
                    onChange={e => {
                      const val = e.target.value;
                      setAddBranchForm(f => ({ ...f, address: val }));
                    }}
                    placeholder="Enter street address, locality, city"
                    required
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="find-on-map-button"
                    disabled={addBranchResolving || !addBranchForm.address.trim()}
                    onClick={handleFindOnMapAdd}
                  >
                    {addBranchResolving ? 'Searching…' : '🔍 Find on Map'}
                  </button>
                </div>
              </label>

              {addBranchSuggestions.length > 0 && (
                <div className="address-suggestions-container">
                  <div className="suggestions-header">
                    <span className="suggestions-title">
                      Address Matches / Suggestions ({addBranchSuggestions.length})
                    </span>
                    <button
                      type="button"
                      className="suggestions-close-btn"
                      onClick={() => setAddBranchSuggestions([])}
                    >
                      ✕ Close
                    </button>
                  </div>
                  <div className="suggestions-list">
                    {addBranchSuggestions.map((item, idx) => {
                      const isSelected =
                        addBranchCoords &&
                        Math.abs(addBranchCoords.lat - item.lat) < 0.0001 &&
                        Math.abs(addBranchCoords.lng - item.lng) < 0.0001;
                      return (
                        <button
                          key={item.id || idx}
                          type="button"
                          className={`suggestion-item-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleSelectAddSuggestion(item)}
                        >
                          <div className="suggestion-badge-row">
                            {item.precision === 'exact' ? (
                              <span className="geo-precision-badge exact">✓ Exact Street/Building</span>
                            ) : item.precision === 'approximate_postal' ? (
                              <span className="geo-precision-badge postal">📮 Postal Code Area</span>
                            ) : (
                              <span className="geo-precision-badge approx">⚠️ Approximate Locality</span>
                            )}
                            <span className="suggestion-coords">
                              {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                            </span>
                          </div>
                          <p className="suggestion-display-name">{item.displayName}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {addBranchGeocodeMsg?.text && (
                <div className={`geocode-alert-box ${addBranchGeocodeMsg.type || 'approx'}`}>
                  {addBranchGeocodeMsg.text}
                </div>
              )}

              <div style={{ marginTop: '10px' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                  Branch Map Location
                </span>
                <p className="muted" style={{ marginBottom: '8px' }}>
                  Pinpoint the branch coordinates. Click or drag the marker to adjust.
                </p>
                <PharmacyLocationPicker
                  position={addBranchCoords}
                  onChange={handleBranchLocationChangeAdd}
                />
              </div>

              <div className="branch-modal-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setShowAddBranchModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-submit"
                  disabled={savingAddBranch || addBranchResolving}
                >
                  {savingAddBranch ? 'Creating Branch…' : 'Add Branch'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Branch Modal */}
      {editingBranch && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setEditingBranch(null); }}>
          <div className="branch-modal-card">
            <button
              type="button"
              className="close"
              onClick={() => setEditingBranch(null)}
              aria-label="Close edit branch modal"
            >
              ×
            </button>
            <div className="branch-modal-header">
              <p className="eyebrow">{editingBranch.isMain ? 'MAIN BRANCH SETTINGS' : 'EDIT BRANCH'}</p>
              <h2>Edit Branch: {editingBranch.name}</h2>
              <p>Update branch contact information, address, and physical location</p>
            </div>

            {editBranchErr && <div className="error-box" style={{ marginBottom: '14px' }}>{editBranchErr}</div>}

            <form onSubmit={handleEditBranchSubmit} className="form-grid">
              <label>
                Branch Name
                <input
                  type="text"
                  value={editBranchForm.name}
                  onChange={e => setEditBranchForm(f => ({ ...f, name: e.target.value }))}
                  required
                />
              </label>

              <label>
                Phone Number
                <input
                  type="text"
                  value={editBranchForm.phone}
                  onChange={e => setEditBranchForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+91 98765 43210"
                />
              </label>

              <label>
                Branch Address
                <div className="address-input-row" style={{ marginTop: '4px' }}>
                  <input
                    type="text"
                    value={editBranchForm.address}
                    onChange={e => {
                      const val = e.target.value;
                      setEditBranchForm(f => ({ ...f, address: val }));
                    }}
                    required
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="find-on-map-button"
                    disabled={editBranchResolving || !editBranchForm.address.trim()}
                    onClick={handleFindOnMapEdit}
                  >
                    {editBranchResolving ? 'Searching…' : '🔍 Find on Map'}
                  </button>
                </div>
              </label>

              {editBranchSuggestions.length > 0 && (
                <div className="address-suggestions-container">
                  <div className="suggestions-header">
                    <span className="suggestions-title">
                      Address Matches / Suggestions ({editBranchSuggestions.length})
                    </span>
                    <button
                      type="button"
                      className="suggestions-close-btn"
                      onClick={() => setEditBranchSuggestions([])}
                    >
                      ✕ Close
                    </button>
                  </div>
                  <div className="suggestions-list">
                    {editBranchSuggestions.map((item, idx) => {
                      const isSelected =
                        editBranchCoords &&
                        Math.abs(editBranchCoords.lat - item.lat) < 0.0001 &&
                        Math.abs(editBranchCoords.lng - item.lng) < 0.0001;
                      return (
                        <button
                          key={item.id || idx}
                          type="button"
                          className={`suggestion-item-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => handleSelectEditSuggestion(item)}
                        >
                          <div className="suggestion-badge-row">
                            {item.precision === 'exact' ? (
                              <span className="geo-precision-badge exact">✓ Exact Street/Building</span>
                            ) : item.precision === 'approximate_postal' ? (
                              <span className="geo-precision-badge postal">📮 Postal Code Area</span>
                            ) : (
                              <span className="geo-precision-badge approx">⚠️ Approximate Locality</span>
                            )}
                            <span className="suggestion-coords">
                              {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                            </span>
                          </div>
                          <p className="suggestion-display-name">{item.displayName}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {editBranchGeocodeMsg?.text && (
                <div className={`geocode-alert-box ${editBranchGeocodeMsg.type || 'approx'}`}>
                  {editBranchGeocodeMsg.text}
                </div>
              )}

              <div style={{ marginTop: '10px' }}>
                <span style={{ fontSize: '0.88rem', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                  Branch Map Location
                </span>
                <p className="muted" style={{ marginBottom: '8px' }}>
                  Pinpoint the branch coordinates. Click or drag the marker to adjust.
                </p>
                <PharmacyLocationPicker
                  position={editBranchCoords}
                  onChange={handleBranchLocationChangeEdit}
                />
              </div>

              {!editingBranch.isMain && (
                <label className="modal-checkbox-row">
                  <input
                    type="checkbox"
                    checked={editBranchForm.isActive}
                    onChange={e => setEditBranchForm(f => ({ ...f, isActive: e.target.checked }))}
                  />
                  <span>Branch is Active (visible to patients and staff)</span>
                </label>
              )}

              <div className="branch-modal-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setEditingBranch(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-submit"
                  disabled={savingEditBranch || editBranchResolving}
                >
                  {savingEditBranch ? 'Saving Changes…' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Staff Modal (Owner Only) */}
      {showAddStaffModal && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowAddStaffModal(false); }}>
          <div className="branch-modal-card">
            <button
              type="button"
              className="close"
              onClick={() => setShowAddStaffModal(false)}
              aria-label="Close modal"
            >
              ×
            </button>
            <div className="branch-modal-header">
              <p className="eyebrow">NEW STAFF MEMBER</p>
              <h2>Add Staff to {activeBranch?.name}</h2>
              <p className="branch-modal-subtitle">
                Create login credentials for a staff member stationed at this branch.
              </p>
            </div>

            <form onSubmit={handleAddStaffSubmit} className="form-grid">
              <label>
                Assigned Pharmacy Branch
                <input
                  type="text"
                  readOnly
                  disabled
                  value={activeBranch?.name ? `${activeBranch.name}${activeBranch.isMain ? ' (Main Branch)' : ''}` : ''}
                  style={{ background: 'var(--card-bg, #f4f6f8)', cursor: 'not-allowed', color: 'var(--ink)' }}
                />
              </label>

              <label>
                Staff Full Name *
                <input
                  type="text"
                  required
                  placeholder="e.g. Rahul Sharma"
                  value={addStaffForm.name}
                  onChange={e => setAddStaffForm(f => ({ ...f, name: e.target.value }))}
                />
              </label>

              <label>
                Email *
                <input
                  type="email"
                  required
                  placeholder="e.g. rahul@example.com"
                  value={addStaffForm.email}
                  onChange={e => setAddStaffForm(f => ({ ...f, email: e.target.value }))}
                />
              </label>

              <label>
                Temporary Password * (minimum 6 characters)
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={addStaffForm.password}
                  onChange={e => setAddStaffForm(f => ({ ...f, password: e.target.value }))}
                />
              </label>

              <label>
                Confirm Password *
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="••••••••"
                  value={addStaffForm.confirmPassword}
                  onChange={e => setAddStaffForm(f => ({ ...f, confirmPassword: e.target.value }))}
                />
              </label>

              {addStaffErr && <div className="error-box">{addStaffErr}</div>}

              <div className="branch-modal-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  disabled={savingStaff}
                  onClick={() => setShowAddStaffModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-submit"
                  disabled={savingStaff}
                >
                  {savingStaff ? 'Creating Staff Account…' : 'Add Staff Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
