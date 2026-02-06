import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Shield, Plus, Power, Loader, RefreshCw, Verified, AlertCircle
} from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { useRegistry, AssetType, type RWAAsset } from '../hooks/useRegistry';
import {
  Card, PageHeader, Button, FormInput, ErrorAlert, SuccessAlert, WarningAlert,
  LoadingState, EmptyState, SectionHeader
} from './ui';

// Asset type labels for display
const ASSET_TYPE_LABELS: Record<number, string> = {
  0: 'Treasury Bond',
  1: 'Corporate Bond',
  2: 'Municipal Bond',
  3: 'Equity',
  4: 'Real Estate',
  5: 'Commodity',
  6: 'Other',
};

// Asset type options for dropdown
const ASSET_TYPE_OPTIONS = [
  { value: AssetType.TreasuryBond, label: 'Treasury Bond' },
  { value: AssetType.CorporateBond, label: 'Corporate Bond' },
  { value: AssetType.MunicipalBond, label: 'Municipal Bond' },
  { value: AssetType.Equity, label: 'Equity' },
  { value: AssetType.RealEstate, label: 'Real Estate' },
  { value: AssetType.Commodity, label: 'Commodity' },
  { value: AssetType.Other, label: 'Other' },
];

interface FormData {
  symbol: string;
  tokenAddress: string;
  assetType: AssetType;
  minTradeSize: string;
  maxOrderSize: string;
}

interface FormErrors {
  symbol?: string;
  tokenAddress?: string;
  minTradeSize?: string;
  maxOrderSize?: string;
}

const Admin: React.FC = () => {
  const { address, isConnected } = useWallet();
  const {
    getAdmin, getAllAssets, registerAsset, deactivateAsset,
    isLoading, error
  } = useRegistry();

  // State
  const [adminAddress, setAdminAddress] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [assets, setAssets] = useState<RWAAsset[]>([]);
  const [loadingAssets, setLoadingAssets] = useState(true);
  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  // Form state
  const [formData, setFormData] = useState<FormData>({
    symbol: '',
    tokenAddress: '',
    assetType: AssetType.TreasuryBond,
    minTradeSize: '',
    maxOrderSize: '',
  });
  const [formErrors, setFormErrors] = useState<FormErrors>({});

  // Check admin status
  const checkAdminStatus = useCallback(async () => {
    setCheckingAdmin(true);
    try {
      const admin = await getAdmin();
      setAdminAddress(admin);
      setIsAdmin(!!address && !!admin && address === admin);
    } catch (err) {
      console.error('Failed to check admin status:', err);
    } finally {
      setCheckingAdmin(false);
    }
  }, [getAdmin, address]);

  // Load all assets
  const loadAssets = useCallback(async () => {
    setLoadingAssets(true);
    try {
      const allAssets = await getAllAssets();
      setAssets(allAssets);
    } catch (err) {
      console.error('Failed to load assets:', err);
    } finally {
      setLoadingAssets(false);
    }
  }, [getAllAssets]);

  // Initial load
  useEffect(() => {
    checkAdminStatus();
    loadAssets();
  }, [checkAdminStatus, loadAssets]);

  // Clear success message after delay
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Form validation
  const validateForm = (): boolean => {
    const errors: FormErrors = {};

    // Symbol validation
    if (!formData.symbol.trim()) {
      errors.symbol = 'Symbol is required';
    } else if (formData.symbol.length > 12) {
      errors.symbol = 'Symbol must be 12 characters or less';
    }

    // Token address validation
    if (!formData.tokenAddress.trim()) {
      errors.tokenAddress = 'Token address is required';
    } else if (!formData.tokenAddress.startsWith('C')) {
      errors.tokenAddress = 'Address must start with C';
    } else if (formData.tokenAddress.length !== 56) {
      errors.tokenAddress = 'Address must be 56 characters';
    }

    // Min trade size validation
    const minSize = Number(formData.minTradeSize);
    if (!formData.minTradeSize.trim()) {
      errors.minTradeSize = 'Min trade size is required';
    } else if (isNaN(minSize) || minSize <= 0) {
      errors.minTradeSize = 'Must be greater than 0';
    }

    // Max order size validation
    const maxSize = Number(formData.maxOrderSize);
    if (!formData.maxOrderSize.trim()) {
      errors.maxOrderSize = 'Max order size is required';
    } else if (isNaN(maxSize) || maxSize <= 0) {
      errors.maxOrderSize = 'Must be greater than 0';
    } else if (maxSize < minSize) {
      errors.maxOrderSize = 'Must be >= min trade size';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm() || !isAdmin) return;

    try {
      const asset: RWAAsset = {
        symbol: formData.symbol.toUpperCase(),
        token_address: formData.tokenAddress,
        asset_type: formData.assetType,
        min_trade_size: BigInt(Math.floor(Number(formData.minTradeSize) * 1e7)),
        max_order_size: BigInt(Math.floor(Number(formData.maxOrderSize) * 1e7)),
        is_active: true,
      };

      await registerAsset(asset);
      setSuccessMessage(`Asset ${asset.symbol} registered successfully`);

      // Reset form
      setFormData({
        symbol: '',
        tokenAddress: '',
        assetType: AssetType.TreasuryBond,
        minTradeSize: '',
        maxOrderSize: '',
      });
      setFormErrors({});

      // Reload assets
      await loadAssets();
    } catch (err) {
      console.error('Failed to register asset:', err);
    }
  };

  // Handle asset deactivation
  const handleDeactivate = async (tokenAddress: string) => {
    if (!isAdmin) return;
    setDeactivatingId(tokenAddress);

    try {
      await deactivateAsset(tokenAddress);
      setSuccessMessage('Asset deactivated successfully');
      await loadAssets();
    } catch (err) {
      console.error('Failed to deactivate asset:', err);
    } finally {
      setDeactivatingId(null);
    }
  };

  // Update form field
  const updateField = (field: keyof FormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when field is edited
    if (formErrors[field as keyof FormErrors]) {
      setFormErrors(prev => ({ ...prev, [field]: undefined }));
    }
  };

  if (!isConnected) {
    return (
      <div className="w-full min-h-screen relative px-4 md:px-6 py-6">
        <div className="fixed inset-0 bg-black z-0">
          <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand-stellar/5 blur-[150px] pointer-events-none"></div>
        </div>
        <div className="relative z-10 max-w-6xl mx-auto">
          <PageHeader title="Admin Panel" subtitle="Connect your wallet to access admin functions" />
          <EmptyState
            icon={Settings}
            title="Wallet Not Connected"
            description="Please connect your wallet to access the admin panel"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen relative px-4 md:px-6 py-6">
      {/* Background */}
      <div className="fixed inset-0 bg-black z-0">
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-brand-stellar/5 blur-[150px] pointer-events-none"></div>
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] bg-emerald-500/5 blur-[100px] pointer-events-none"></div>
      </div>

      <div className="relative z-10 max-w-6xl mx-auto">
        <PageHeader
          title="Admin Panel"
          subtitle="Manage RWA asset registration"
          actions={
            <div className="flex items-center gap-2">
              {checkingAdmin ? (
                <span className="text-xs text-gray-500">Checking admin status...</span>
              ) : isAdmin ? (
                <span className="flex items-center gap-1 text-xs text-emerald-400">
                  <Shield className="w-3 h-3" />
                  Admin Access
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-yellow-400">
                  <AlertCircle className="w-3 h-3" />
                  View Only
                </span>
              )}
            </div>
          }
        />

        {/* Non-admin warning */}
        {!checkingAdmin && !isAdmin && (
          <WarningAlert className="mb-6">
            You are not the contract admin. Only the admin ({adminAddress ? `${adminAddress.slice(0, 8)}...${adminAddress.slice(-4)}` : 'unknown'}) can register or deactivate assets.
          </WarningAlert>
        )}

        {/* Success/Error Messages */}
        {successMessage && (
          <SuccessAlert className="mb-6">{successMessage}</SuccessAlert>
        )}
        {error && (
          <ErrorAlert className="mb-6">{error}</ErrorAlert>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Panel - Registration Form */}
          <Card padding="none" className="overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center gap-2">
              <Plus className="w-4 h-4 text-brand-stellar" />
              <h3 className="text-sm font-bold text-white uppercase tracking-wide">Register New Asset</h3>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              <FormInput
                label="Symbol"
                placeholder="e.g., USDC"
                value={formData.symbol}
                onChange={(e) => updateField('symbol', e.target.value)}
                error={formErrors.symbol}
                helperText="Max 12 characters"
                disabled={!isAdmin || isLoading}
              />

              <FormInput
                label="Token Contract Address"
                placeholder="C..."
                value={formData.tokenAddress}
                onChange={(e) => updateField('tokenAddress', e.target.value)}
                error={formErrors.tokenAddress}
                helperText="56 character Stellar contract address"
                disabled={!isAdmin || isLoading}
              />

              <div className="w-full">
                <div className="flex justify-between items-center mb-2">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                    Asset Type
                  </label>
                </div>
                <select
                  value={formData.assetType}
                  onChange={(e) => updateField('assetType', Number(e.target.value))}
                  disabled={!isAdmin || isLoading}
                  className="w-full bg-black/30 border border-white/5 px-4 py-2 text-white font-mono
                    focus:outline-none focus:border-brand-stellar/30 transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {ASSET_TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <FormInput
                  label="Min Trade Size"
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  value={formData.minTradeSize}
                  onChange={(e) => updateField('minTradeSize', e.target.value)}
                  error={formErrors.minTradeSize}
                  disabled={!isAdmin || isLoading}
                />

                <FormInput
                  label="Max Order Size"
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  value={formData.maxOrderSize}
                  onChange={(e) => updateField('maxOrderSize', e.target.value)}
                  error={formErrors.maxOrderSize}
                  disabled={!isAdmin || isLoading}
                />
              </div>

              <Button
                type="submit"
                fullWidth
                disabled={!isAdmin || isLoading}
                isLoading={isLoading}
              >
                {isLoading ? 'Registering...' : 'Register Asset'}
              </Button>
            </form>
          </Card>

          {/* Right Panel - Assets List */}
          <Card padding="none" className="overflow-hidden">
            <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-brand-stellar" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wide">Registered Assets</h3>
                <span className="px-2 py-0.5 bg-brand-stellar/20 text-brand-stellar text-[10px] font-bold">
                  {assets.length}
                </span>
              </div>
              <button
                onClick={loadAssets}
                className="p-1.5 hover:bg-white/10 transition-colors text-gray-500 hover:text-white"
                disabled={loadingAssets}
              >
                <RefreshCw className={`w-4 h-4 ${loadingAssets ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="p-4">
              {loadingAssets ? (
                <LoadingState message="Loading assets..." />
              ) : assets.length === 0 ? (
                <EmptyState
                  icon={Shield}
                  title="No Assets Registered"
                  description="Register your first asset using the form"
                />
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-y-auto">
                  {assets.map((asset) => (
                    <div
                      key={asset.token_address}
                      className={`p-3 bg-black/30 border ${asset.is_active ? 'border-white/5' : 'border-white/5 opacity-60'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-white">{asset.symbol}</span>
                            {asset.is_active && <Verified className="w-3 h-3 text-brand-stellar" />}
                            <span className={`text-[10px] px-1.5 py-0.5 ${
                              asset.is_active
                                ? 'bg-emerald-500/10 text-emerald-400'
                                : 'bg-rose-500/10 text-rose-400'
                            }`}>
                              {asset.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                          <p className="text-[10px] text-gray-500 font-mono truncate">
                            {asset.token_address}
                          </p>
                          <div className="flex items-center gap-4 mt-2">
                            <span className="text-[10px] text-gray-400">
                              Type: {ASSET_TYPE_LABELS[asset.asset_type] || 'Unknown'}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              Min: {Number(asset.min_trade_size) / 1e7}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              Max: {Number(asset.max_order_size) / 1e7}
                            </span>
                          </div>
                        </div>

                        {asset.is_active && isAdmin && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDeactivate(asset.token_address)}
                            disabled={deactivatingId === asset.token_address}
                            isLoading={deactivatingId === asset.token_address}
                          >
                            <Power className="w-3 h-3" />
                            Deactivate
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Admin;
