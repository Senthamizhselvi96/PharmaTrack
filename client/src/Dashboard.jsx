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

export default function Dashboard({ auth, socket, onLogout }) {
  const isOwner = auth.role === 'pharmacy';
  const isStaff = auth.role === 'staff';

  const [stock, setStock] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [stockFilter, setStockFilter] = useState('all');
  const [profile, setProfile] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [view, setView] = useState('dashboard');
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

  const token = auth.token;
  const profileMenuRef = useRef(null);
  const reverseGeocodeReqIdRef = useRef(0);
  const selectedBranchIdRef = useRef(selectedBranchId);

  useEffect(() => {
    selectedBranchIdRef.current = selectedBranchId;
  }, [selectedBranchId]);

  const activeBranch = useMemo(() => {
    if (isStaff) {
      return auth.branch
        ? {
            _id: auth.branch.id || auth.branch?._id,
            name: auth.branch.name,
            address: auth.branch.address,
            isMain: auth.branch.isMain
          }
        : null;
    }
    return branches.find(b => b._id === selectedBranchId) || null;
  }, [isStaff, auth.branch, branches, selectedBranchId]);

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

  // Permission checkers for Task 9 actions
  const canApprove = (t) => {
    if (t.status !== 'pending') return false;
    if (isOwner) return true;
    const staffBranch = String(auth.branch?.id || auth.branch?._id || '');
    return isStaff && String(t.fromBranch?._id || t.fromBranch) === staffBranch;
  };

  const canReject = (t) => {
    if (t.status !== 'pending') return false;
    if (isOwner) return true;
    const staffBranch = String(auth.branch?.id || auth.branch?._id || '');
    return isStaff && String(t.fromBranch?._id || t.fromBranch) === staffBranch;
  };

  const canDispatch = (t) => {
    if (t.status !== 'approved') return false;
    if (isOwner) return true;
    const staffBranch = String(auth.branch?.id || auth.branch?._id || '');
    return isStaff && String(t.fromBranch?._id || t.fromBranch) === staffBranch;
  };

  const canReceive = (t) => {
    if (t.status !== 'dispatched') return false;
    if (isOwner) return true;
    const staffBranch = String(auth.branch?.id || auth.branch?._id || '');
    return isStaff && String(t.toBranch?._id || t.toBranch) === staffBranch;
  };

  const canCancel = (t) => {
    if (!['pending', 'approved'].includes(t.status)) return false;
    if (isOwner) return true;
    const staffBranch = String(auth.branch?.id || auth.branch?._id || '');
    const isRequesterUser = String(t.requestedBy?.userId) === String(auth.id);
    const isDestStaff = String(t.toBranch?._id || t.toBranch) === staffBranch;
    return isStaff && (isRequesterUser || isDestStaff);
  };

  const filteredTransfers = useMemo(() => {
    return transfers.filter(t => {
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
    return transfers.filter(t => t.status === 'pending').length;
  }, [transfers]);

  const loadTransfers = async () => {
    try {
      setLoadingTransfers(true);
      setTransferErr('');
      const data = await api('/pharmacy/transfers', { token });
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
      const destId = isOwner ? selectedBranchIdRef.current : (auth.branch?.id || auth.branch?._id);
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
      setProfile({
        name: auth.name,
        email: auth.email,
        branchName: auth.branch?.name
      });
      return;
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

  useEffect(() => {
    if (isOwner) {
      loadBranches();
      loadProfile();
    } else {
      load();
    }
  }, []);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => load().catch(e => setErr(e.message));
    const onTransferChange = () => {
      loadTransfers();
      loadAvailableStock();
      load().catch(e => setErr(e.message));
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
  }, [socket]);

  const handleBranchChange = async (e) => {
    const nextBranchId = e.target.value;
    setSelectedBranchId(nextBranchId);
    localStorage.setItem('pf_selected_branch_' + auth.id, nextBranchId);
    setItem(blank);
    await load(nextBranchId);
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
      setItem(blank);
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

  return (
    <div className="app-shell">
      <header className="topbar pharmacy-topbar">
        <div className="brand">
          <img
            src="/pharmatrack-logo.png"
            alt="PharmaTrack"
            className="brand-logo"
          />
        </div>

        <nav className="pharmacy-nav" aria-label="Pharmacy navigation">
          <button
            type="button"
            className={view === 'dashboard' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
            onClick={() => setView('dashboard')}
          >
            Dashboard
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

          {isOwner && (
            <button
              type="button"
              className={view === 'branches' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
              onClick={() => {
                setView('branches');
                loadBranches();
              }}
            >
              Branches
              {branches.length > 0 && <span className="nav-badge branch-nav-badge">{branches.length}</span>}
            </button>
          )}

          <button
            type="button"
            className={view === 'transfers' ? 'pharmacy-nav-link active' : 'pharmacy-nav-link'}
            onClick={() => {
              setView('transfers');
              loadTransfers();
              loadAvailableStock();
            }}
          >
            Transfers
            {pendingTransfersCount > 0 && <span className="nav-badge transfer-nav-badge">{pendingTransfersCount}</span>}
          </button>
        </nav>

        {/* Branch Selector (Owner) / Assigned Branch Display (Staff) */}
        <div className="branch-selector-header">
          {isOwner ? (
            <div className="branch-selector-container">
              <label htmlFor="pharmacy-branch-select" className="branch-selector-label">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                Branch:
              </label>
              <select
                id="pharmacy-branch-select"
                className="branch-selector-dropdown"
                value={selectedBranchId || ''}
                onChange={handleBranchChange}
                disabled={loadingBranches}
                aria-label="Select active pharmacy branch"
              >
                {branches.length === 0 ? (
                  <option value="">Loading branches...</option>
                ) : (
                  branches.map(b => (
                    <option key={b._id} value={b._id}>
                      {b.name} {b.isMain ? '★ (Main)' : ''} {!b.isActive ? '(Inactive)' : ''}
                    </option>
                  ))
                )}
              </select>
            </div>
          ) : (
            <div className="branch-locked-display" title="Assigned branch for your staff account">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span className="branch-locked-name">{auth.branch?.name || 'Assigned Branch'}</span>
              <span className="branch-locked-badge">Staff Access</span>
            </div>
          )}
        </div>

        <div className="profile-menu-wrap" ref={profileMenuRef}>
          <button
            type="button"
            className="profile-trigger"
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
                  setView('profile');
                  setProfileMenuOpen(false);
                  loadProfile();
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                My Profile
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
          <div className="dashboard-head">
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
            {err && <p className="note">{err}</p>}
            <section className="panel inventory-panel">
              <div className="panel-head">
                <div>
                  <p className="eyebrow">INVENTORY</p>
                  <h2>Add or update stock</h2>
                </div>
              </div>
              <form onSubmit={save} className="form-grid">
                <label>Medicine name<input value={item.medicine} onChange={e => setItem({ ...item, medicine: e.target.value })} placeholder="Paracetamol 500mg" required /></label>
                <label>Generic name<input value={item.generic} onChange={e => setItem({ ...item, generic: e.target.value })} placeholder="Paracetamol" /></label>
                <div className="two-col"><label>Quantity<input type="number" min="0" value={item.quantity} onChange={e => setItem({ ...item, quantity: Number(e.target.value) })} /></label><label>Price per tablet/unit (₹)<input type="number" min="0" step="0.01" value={item.price} onChange={e => setItem({ ...item, price: e.target.value })} placeholder="2.00" /></label></div>
                <button disabled={busy}>
                  {busy ? 'Saving…' : item._id ? 'Update Stock' : 'Add Medicine'}
                </button>
              </form>
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

                  <div className="inventory-search-box">
                    <svg className="inventory-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input
                      type="search"
                      className="inventory-search-input"
                      placeholder="Search medicine or generic name..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      aria-label="Search medicines by name or generic name"
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
                      Your pharmacy inventory is currently empty. Use the form above to add your first medicine and stock quantity.
                    </p>
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
                                    onClick={() =>
                                      setItem({
                                        ...s,
                                        price: s.price ?? ''
                                      })
                                    }
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
                                        await load();
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
        </>
      )}

      {view === 'reservations' && (
        <>
          <div className="dashboard-head">
            <div>
              <p className="eyebrow">PATIENT RESERVATIONS</p>
              <h1>{activeBranch?.name ? `${activeBranch.name} Reservations` : 'Manage Medicine Requests'}</h1>
              {activeBranch && (
                <p className="branch-active-subtitle">
                  <span>📍 {activeBranch.address}</span>
                  {activeBranch.isMain && <span className="badge-main-branch">★ Main Branch</span>}
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
            <section className="panel">
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
        </>
      )}

      {view === 'branches' && isOwner && (
        <>
          <div className="dashboard-head">
            <div>
              <p className="eyebrow">PHARMACY BRANCH MANAGEMENT</p>
              <h1>Branch Locations</h1>
              <p className="branch-active-subtitle">
                Manage physical pharmacy branches, locations, and view individual branch inventory.
              </p>
            </div>
            <div>
              <button
                type="button"
                className="btn-add-branch"
                onClick={() => {
                  setShowAddBranchModal(true);
                  setAddBranchForm({ name: '', phone: '', address: '' });
                  setAddBranchCoords(null);
                  setAddBranchErr('');
                  setAddBranchGeocodeMsg('');
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
                    <article key={b._id} className={`branch-card ${isSelected ? 'is-active-branch' : ''}`}>
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
                        {isSelected ? (
                          <span className="current-branch-tag">✓ Active Branch</span>
                        ) : (
                          <button
                            type="button"
                            className="btn-select-branch"
                            onClick={() => {
                              setSelectedBranchId(b._id);
                              localStorage.setItem('pf_selected_branch_' + auth.id, b._id);
                              load(b._id);
                              setView('dashboard');
                            }}
                          >
                            View Inventory →
                          </button>
                        )}

                        <button
                          type="button"
                          className="btn-edit-branch"
                          onClick={() => openEditBranchModal(b)}
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
          <div className="dashboard-head">
            <div>
              <p className="eyebrow">INTER-BRANCH MEDICINE TRANSFERS</p>
              <h1>Stock Transfer Requests</h1>
              <p className="branch-active-subtitle">
                {isOwner
                  ? `Active Requesting Branch: ${activeBranch?.name || 'Selected Branch'} (requests will be delivered to this branch)`
                  : `Your Assigned Branch: ${auth.branch?.name || 'Assigned Branch'} (requests will be delivered to this branch)`}
              </p>
            </div>
            <div className="reservations-meta-stats">
              <span className="reservations-count-pill">
                <strong>{pendingTransfersCount}</strong> pending / {transfers.length} total
              </span>
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
                        onClick={() => setSelectedTransferCandidate(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </section>

            {/* 2. Transfer Requests History Panel */}
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
                      : 'No medicine transfer requests have been created yet. Use the search panel above to request stock.'}
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

                    {confirmModal.action === 'dispatch' && (
                      <div className="transfer-modal-warning">
                        <strong>⚠️ Stock Deduction Warning:</strong> Confirming dispatch will atomically deduct{' '}
                        <strong>{confirmModal.transfer.requestedQuantity} units</strong> from{' '}
                        <strong>{confirmModal.transfer.fromBranch?.name}</strong>. Please ensure the physical medicines are packed for transport.
                      </div>
                    )}

                    {confirmModal.action === 'receive' && (
                      <div className="transfer-modal-warning" style={{ background: '#f0fdf4', borderColor: '#bbf7d0', color: '#166534' }}>
                        <strong>✓ Stock Addition:</strong> Confirming receipt will immediately add{' '}
                        <strong>{confirmModal.transfer.dispatchedQuantity || confirmModal.transfer.requestedQuantity} units</strong>{' '}
                        to <strong>{confirmModal.transfer.toBranch?.name}</strong>'s inventory for dispensing.
                      </div>
                    )}

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

{view === 'profile' && (
  <main className="content-wrap pharmacy-profile-view">
    <div className="profile-page-nav">
      <button
        type="button"
        className="back-button"
        onClick={() => setView('dashboard')}
      >
        ← Back to Dashboard
      </button>
      <span className="profile-breadcrumb">Pharmacy Portal / Account Profile</span>
    </div>

    {err && <p className="note">{err}</p>}

    {/* Profile Header Hero */}
    <section className="pharmacy-profile-hero">
      <div className="hero-avatar-wrap">
        <span className="pharmacy-hero-avatar">
          {(profile?.name || auth.name || 'P').trim().charAt(0).toUpperCase()}
        </span>
      </div>

      <div className="hero-meta-wrap">
        <span className="pharmacy-account-badge">
          <span className="badge-status-dot" aria-hidden="true"></span>
          Pharmacy Account
        </span>
        <h1 className="pharmacy-hero-title">{profile?.name || auth.name}</h1>
        <p className="pharmacy-hero-subtitle">
          {profile?.createdAt
            ? `Member pharmacy since ${new Date(profile.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`
            : 'PharmaTrack Partner Pharmacy'}
        </p>
      </div>
    </section>

    {/* Profile Details Sections Grid */}
    <div className="pharmacy-profile-sections">
      {/* 1. Pharmacy Information */}
      <section className="profile-section-card">
        <div className="section-card-header">
          <span className="section-icon" aria-hidden="true">🏥</span>
          <div>
            <h2>Pharmacy Information</h2>
            <p className="section-subtitle">Registered facility name & location details</p>
          </div>
        </div>

        <div className="section-card-body">
          <div className="info-field">
            <span className="info-label">Pharmacy Name</span>
            <span className="info-value name-highlight">{profile?.name || auth.name}</span>
          </div>

          <div className="info-field">
            <span className="info-label">{isStaff ? 'Branch Address' : 'Pharmacy Address'}</span>
            {!editingAddress ? (
              <div>
                <div className="address-display-box">
                  <p className="info-value address-text">
                    {profile?.address || (isStaff ? auth.branch?.address : 'Address not specified')}
                  </p>
                  {isOwner && (
                    <button
                      type="button"
                      className="edit-address-button"
                      onClick={() => {
                        const saved = parseCoordinates(profile?.location);
                        if (saved) {
                          setSelectedLocation(saved);
                        }
                        setTypedAddress(profile?.address || '');
                        setAddressNeedsResolution(false);
                        setAddressMsg({ type: '', text: '' });
                        setGeocodeMsg('');
                        setEditingAddress(true);
                      }}
                    >
                      Edit Address
                    </button>
                  )}
                </div>
                {addressMsg.text && (
                  <div
                    className={addressMsg.type === 'error' ? 'error-box' : 'hint'}
                    style={{
                      marginTop: '10px',
                      color: addressMsg.type === 'success' ? 'var(--pine)' : undefined,
                      fontWeight: addressMsg.type === 'success' ? '600' : undefined
                    }}
                  >
                    {addressMsg.type === 'success' ? '✓ ' : ''}{addressMsg.text}
                  </div>
                )}
              </div>
            ) : (
              <div className="profile-edit-field">
                <div className="address-input-row">
                  <input
                    type="text"
                    value={typedAddress}
                    onChange={handleAddressInputChange}
                    placeholder="Enter your pharmacy address"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="find-on-map-button"
                    disabled={resolvingAddress || !typedAddress.trim()}
                    onClick={handleFindOnMap}
                    title="Search address on map"
                  >
                    {resolvingAddress ? 'Searching…' : '🔍 Find on Map'}
                  </button>
                </div>

                {addressNeedsResolution && (
                  <small className="hint" style={{ display: 'block', marginTop: '6px', color: '#b54708', fontWeight: '500' }}>
                    ⚠️ Address modified. Click &ldquo;Find on Map&rdquo; to locate it or choose a position on the map before saving.
                  </small>
                )}

                {resolvingAddress && (
                  <small className="hint" style={{ display: 'block', marginTop: '6px' }}>
                    🔍 Looking up coordinates for the entered address…
                  </small>
                )}

                {reverseGeocoding && (
                  <small className="hint" style={{ display: 'block', marginTop: '6px' }}>
                    🔍 Looking up address for the selected location…
                  </small>
                )}

                {geocodeMsg && (
                  <p className="note" style={{ marginTop: '8px', marginBottom: '8px' }}>
                    {geocodeMsg}
                  </p>
                )}

                <div style={{ marginTop: '16px', marginBottom: '16px' }}>
                  <h3>Select Pharmacy Location</h3>

                  <p className="muted">
                    Select the exact pharmacy location on the map.
                    Click the map to place a pin or drag the marker.
                  </p>

                  <PharmacyLocationPicker
                    position={selectedLocation}
                    onChange={handleLocationChange}
                  />
                </div>

                <div className="address-actions">
                  <button
                    type="button"
                    className="save-profile-button"
                    disabled={savingAddress || resolvingAddress}
                    onClick={handleSaveAddress}
                  >
                    {savingAddress ? 'Saving Address…' : 'Save Address'}
                  </button>
                  <button
                    type="button"
                    className="cancel-address-button"
                    disabled={savingAddress || resolvingAddress}
                    onClick={() => {
                      reverseGeocodeReqIdRef.current++;
                      setEditingAddress(false);
                      setAddressNeedsResolution(false);
                      setTypedAddress(profile?.address || '');
                      setAddressMsg({ type: '', text: '' });
                      setGeocodeMsg('');
                      loadProfile();
                    }}
                  >
                    Cancel
                  </button>
                </div>

                {addressMsg.text && (
                  <div
                    className={addressMsg.type === 'error' ? 'error-box' : 'hint'}
                    style={{
                      marginTop: '12px',
                      color: addressMsg.type === 'success' ? 'var(--pine)' : undefined,
                      fontWeight: addressMsg.type === 'success' ? '600' : undefined
                    }}
                  >
                    {addressMsg.type === 'success' ? '✓ ' : ''}{addressMsg.text}
                  </div>
                )}
              </div>
            )}
          </div>

          {displayCoordinates && (
            <div className="info-field">
              <span className="info-label">Location Mapping</span>
              <div className="map-integration-box">
                <span className="coordinates-tag">
                  📍 {displayCoordinates.lat.toFixed(4)}° N, {displayCoordinates.lng.toFixed(4)}° E
                </span>
                <a
                  className="map-link-btn"
                  href={`https://www.google.com/maps/dir/?api=1&destination=${displayCoordinates.lat},${displayCoordinates.lng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Google Maps ↗
                </a>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 2. User / Owner Information */}
      <section className="profile-section-card">
        <div className="section-card-header">
          <span className="section-icon" aria-hidden="true">👤</span>
          <div>
            <h2>{isStaff ? 'Staff Information' : 'Owner Information'}</h2>
            <p className="section-subtitle">
              {isStaff ? 'Branch team member credentials' : 'Primary license holder & administrator'}
            </p>
          </div>
        </div>

        <div className="section-card-body">
          <div className="info-field">
            <span className="info-label">{isStaff ? 'Staff Name' : 'Owner Name'}</span>
            <span className="info-value">
              {isStaff ? auth.name : profile?.ownerName || 'Not specified'}
            </span>
          </div>

          <div className="info-field">
            <span className="info-label">Account Role</span>
            <span className="role-tag">
              {isStaff ? 'Branch Staff Member' : 'Pharmacy Administrator'}
            </span>
          </div>

          {isStaff && auth.branch && (
            <div className="info-field">
              <span className="info-label">Assigned Branch</span>
              <span className="info-value name-highlight">
                {auth.branch.name} {auth.branch.isMain ? '(Main Branch)' : ''}
              </span>
            </div>
          )}

          <div className="info-field">
            <span className="info-label">Registration Date</span>
            <span className="info-value">
              {profile?.createdAt
                ? new Date(profile.createdAt).toLocaleDateString('en-US', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                  })
                : '—'}
            </span>
          </div>
        </div>
      </section>

      {/* 3. Contact Information */}
      <section className="profile-section-card">
        <div className="section-card-header">
          <span className="section-icon" aria-hidden="true">📞</span>
          <div>
            <h2>Contact Information</h2>
            <p className="section-subtitle">Communications & patient notifications</p>
          </div>
        </div>

        <div className="section-card-body">
          <div className="info-field">
            <span className="info-label">Email Address</span>
            <span className="info-value contact-value">
              <span className="field-icon" aria-hidden="true">✉️</span>
              {profile?.email || auth.email || '—'}
            </span>
          </div>

          <div className="info-field">
            <span className="info-label">Phone Number</span>
            <span className="info-value contact-value">
              <span className="field-icon" aria-hidden="true">📞</span>
              {profile?.phone || 'Not provided'}
            </span>
          </div>

          <div className="info-field">
            <span className="info-label">Account Status</span>
            <span className="status-live-tag">
              <span className="status-dot-active" aria-hidden="true"></span>
              Active &amp; Verified
            </span>
          </div>
        </div>
      </section>
    </div>
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
    </div>
  );
}
