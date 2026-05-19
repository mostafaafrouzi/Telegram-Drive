import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RotateCcw, Download, Upload, Trash2, HardDrive, Globe, Key, Copy, Check, RefreshCw, FolderArchive, Shield } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { useSettings } from '../../context/SettingsContext';
import { useConfirm } from '../../context/ConfirmContext';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ApiSettings {
    enabled: boolean;
    port: number;
    key_set: boolean;
    running: boolean;
}

type ProxyMode = 'disabled' | 'system' | 'socks5' | 'http';

interface ProxySettings {
    mode: ProxyMode;
    host: string;
    port: number;
    username: string;
    has_password: boolean;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const { settings, updateSetting, resetSettings } = useSettings();
    const { confirm } = useConfirm();
    const [clearing, setClearing] = useState(false);

    // API settings state
    const [apiSettings, setApiSettings] = useState<ApiSettings>({ enabled: false, port: 8550, key_set: false, running: false });
    const [apiPort, setApiPort] = useState('8550');
    const [apiLoading, setApiLoading] = useState(false);
    const [generatedKey, setGeneratedKey] = useState<string | null>(null);
    const [keyCopied, setKeyCopied] = useState(false);

    // Proxy settings state
    const [proxyMode, setProxyMode] = useState<ProxyMode>('disabled');
    const [proxyHost, setProxyHost] = useState('');
    const [proxyPort, setProxyPort] = useState('1080');
    const [proxyUsername, setProxyUsername] = useState('');
    const [proxyPassword, setProxyPassword] = useState('');
    const [proxyLoading, setProxyLoading] = useState(false);
    const [proxyHasPassword, setProxyHasPassword] = useState(false);

    const fetchProxySettings = useCallback(async () => {
        try {
            const result = await invoke<ProxySettings>('cmd_get_proxy_settings');
            setProxyMode(result.mode);
            setProxyHost(result.host);
            setProxyPort(result.port.toString());
            setProxyUsername(result.username);
            setProxyHasPassword(result.has_password);
            setProxyPassword('');
        } catch {
            // Proxy settings not available
        }
    }, []);

    const handleProxySave = async () => {
        const port = parseInt(proxyPort, 10);
        if ((proxyMode === 'socks5' || proxyMode === 'http') && proxyHost.trim() === '') {
            toast.error('Proxy host is required');
            return;
        }
        if (isNaN(port) || port < 1 || port > 65535) {
            toast.error('Port must be between 1 and 65535');
            return;
        }
        setProxyLoading(true);
        try {
            const result = await invoke<ProxySettings>('cmd_update_proxy_settings', {
                mode: proxyMode,
                host: proxyHost.trim(),
                port,
                username: proxyUsername,
                password: proxyPassword,
            });
            setProxyMode(result.mode);
            setProxyHost(result.host);
            setProxyPort(result.port.toString());
            setProxyUsername(result.username);
            setProxyHasPassword(result.has_password);
            setProxyPassword('');
            toast.success(proxyMode === 'disabled' ? 'Proxy disabled' : 'Proxy settings saved — reconnecting...');
        } catch (e) {
            toast.error(`Failed to update proxy: ${e}`);
        } finally {
            setProxyLoading(false);
        }
    };

    const fetchApiSettings = useCallback(async () => {
        try {
            const result = await invoke<ApiSettings>('cmd_get_api_settings');
            setApiSettings(result);
            setApiPort(result.port.toString());
        } catch {
            // API settings not available
        }
    }, []);

    // Load API and proxy settings when modal opens
    useEffect(() => {
        if (isOpen) {
            fetchApiSettings();
            fetchProxySettings();
            setGeneratedKey(null);
            setKeyCopied(false);
        }
    }, [isOpen, fetchApiSettings, fetchProxySettings]);

    // Poll API status while modal is open and API is enabled
    useEffect(() => {
        if (!isOpen || !apiSettings.enabled) return;
        const interval = setInterval(fetchApiSettings, 3000);
        return () => clearInterval(interval);
    }, [isOpen, apiSettings.enabled, fetchApiSettings]);

    const handleApiToggle = async () => {
        setApiLoading(true);
        try {
            const port = parseInt(apiPort, 10);
            if (isNaN(port) || port < 1024 || port > 65535) {
                toast.error('Port must be between 1024 and 65535');
                setApiLoading(false);
                return;
            }
            const result = await invoke<ApiSettings>('cmd_update_api_settings', {
                enabled: !apiSettings.enabled,
                port,
            });
            setApiSettings(result);
            toast.success(result.enabled ? 'API server started' : 'API server stopped');
        } catch (e) {
            toast.error(`Failed to update API: ${e}`);
        } finally {
            setApiLoading(false);
        }
    };

    const handlePortApply = async () => {
        const port = parseInt(apiPort, 10);
        if (isNaN(port) || port < 1024 || port > 65535) {
            toast.error('Port must be between 1024 and 65535');
            return;
        }
        if (port === apiSettings.port) return;
        setApiLoading(true);
        try {
            const result = await invoke<ApiSettings>('cmd_update_api_settings', {
                enabled: apiSettings.enabled,
                port,
            });
            setApiSettings(result);
            toast.success(`API port updated to ${port}`);
        } catch (e) {
            toast.error(`Failed to update port: ${e}`);
        } finally {
            setApiLoading(false);
        }
    };

    const handleGenerateKey = async () => {
        const ok = await confirm({
            title: 'Generate API Key',
            message: apiSettings.key_set
                ? 'This will revoke your current API key and generate a new one. Any existing integrations will stop working.'
                : 'Generate a new API key for authenticating REST API requests.',
            confirmText: apiSettings.key_set ? 'Regenerate' : 'Generate',
            variant: apiSettings.key_set ? 'danger' : 'info',
        });
        if (!ok) return;
        try {
            const key = await invoke<string>('cmd_regenerate_api_key');
            setGeneratedKey(key);
            setKeyCopied(false);
            setApiSettings(prev => ({ ...prev, key_set: true }));
            toast.success('API key generated');
        } catch (e) {
            toast.error(`Failed to generate key: ${e}`);
        }
    };

    const handleCopyKey = async () => {
        if (!generatedKey) return;
        try {
            await navigator.clipboard.writeText(generatedKey);
            setKeyCopied(true);
            setTimeout(() => setKeyCopied(false), 2000);
        } catch {
            toast.error('Failed to copy to clipboard');
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                        className="bg-telegram-surface border border-telegram-border rounded-xl w-[440px] shadow-2xl overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="px-5 py-4 border-b border-telegram-border flex justify-between items-center">
                            <h2 className="text-telegram-text font-semibold text-base">Settings</h2>
                            <button
                                onClick={onClose}
                                className="p-1.5 hover:bg-telegram-hover rounded-lg text-telegram-subtext hover:text-telegram-text transition"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="px-5 py-4 space-y-6 max-h-[70vh] overflow-y-auto">

                            {/* Transfers Section */}
                            <section className="space-y-3">
                                <h3 className="text-xs font-semibold text-telegram-subtext uppercase tracking-wider flex items-center gap-2">
                                    <Upload className="w-3.5 h-3.5" />
                                    Transfers
                                </h3>

                                {/* Max Concurrent Uploads */}
                                <div className="flex items-center justify-between p-3 rounded-lg bg-telegram-hover/50">
                                    <div className="flex items-center gap-2">
                                        <Upload className="w-4 h-4 text-telegram-subtext" />
                                        <div>
                                            <p className="text-sm text-telegram-text font-medium">Concurrent Uploads</p>
                                            <p className="text-xs text-telegram-subtext">Max parallel uploads</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => updateSetting('maxConcurrentUploads', Math.max(1, settings.maxConcurrentUploads - 1))}
                                            className="w-7 h-7 flex items-center justify-center rounded-md bg-telegram-bg text-telegram-subtext hover:text-telegram-text hover:bg-telegram-border transition text-sm font-medium"
                                        >
                                            -
                                        </button>
                                        <span className="text-sm text-telegram-text font-medium w-5 text-center">
                                            {settings.maxConcurrentUploads}
                                        </span>
                                        <button
                                            onClick={() => updateSetting('maxConcurrentUploads', Math.min(10, settings.maxConcurrentUploads + 1))}
                                            className="w-7 h-7 flex items-center justify-center rounded-md bg-telegram-bg text-telegram-subtext hover:text-telegram-text hover:bg-telegram-border transition text-sm font-medium"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>

                                {/* Max Concurrent Downloads */}
                                <div className="flex items-center justify-between p-3 rounded-lg bg-telegram-hover/50">
                                    <div className="flex items-center gap-2">
                                        <Download className="w-4 h-4 text-telegram-subtext" />
                                        <div>
                                            <p className="text-sm text-telegram-text font-medium">Concurrent Downloads</p>
                                            <p className="text-xs text-telegram-subtext">Max parallel downloads</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => updateSetting('maxConcurrentDownloads', Math.max(1, settings.maxConcurrentDownloads - 1))}
                                            className="w-7 h-7 flex items-center justify-center rounded-md bg-telegram-bg text-telegram-subtext hover:text-telegram-text hover:bg-telegram-border transition text-sm font-medium"
                                        >
                                            -
                                        </button>
                                        <span className="text-sm text-telegram-text font-medium w-5 text-center">
                                            {settings.maxConcurrentDownloads}
                                        </span>
                                        <button
                                            onClick={() => updateSetting('maxConcurrentDownloads', Math.min(10, settings.maxConcurrentDownloads + 1))}
                                            className="w-7 h-7 flex items-center justify-center rounded-md bg-telegram-bg text-telegram-subtext hover:text-telegram-text hover:bg-telegram-border transition text-sm font-medium"
                                        >
                                            +
                                        </button>
                                    </div>
                                </div>

                                {/* Zip Folders */}
                                <div className="flex items-center justify-between p-3 rounded-lg bg-telegram-hover/50">
                                    <div className="flex items-center gap-2">
                                        <FolderArchive className="w-4 h-4 text-telegram-subtext" />
                                        <div>
                                            <p className="text-sm text-telegram-text font-medium">Zip Folders Before Upload</p>
                                            <p className="text-xs text-telegram-subtext">Compress folders into .zip before uploading</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => updateSetting('zipFolders', !settings.zipFolders)}
                                        className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${settings.zipFolders ? 'bg-telegram-primary' : 'bg-telegram-border'}`}
                                    >
                                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${settings.zipFolders ? 'translate-x-5' : 'translate-x-0'}`} />
                                    </button>
                                </div>
                            </section>

                            {/* Proxy Settings Section */}
                            <section className="space-y-3">
                                <h3 className="text-xs font-semibold text-telegram-subtext uppercase tracking-wider flex items-center gap-2">
                                    <Shield className="w-3.5 h-3.5" />
                                    Proxy
                                </h3>

                                {/* Proxy Mode Select */}
                                <div className="flex items-center justify-between p-3 rounded-lg bg-telegram-hover/50">
                                    <div>
                                        <p className="text-sm text-telegram-text font-medium">Proxy Mode</p>
                                        <p className="text-xs text-telegram-subtext">Route Telegram traffic through a proxy</p>
                                    </div>
                                    <select
                                        value={proxyMode}
                                        onChange={e => setProxyMode(e.target.value as ProxyMode)}
                                        className="bg-telegram-bg border border-telegram-border rounded-md px-2 py-1.5 text-sm text-telegram-text focus:outline-none focus:border-telegram-primary/50 transition cursor-pointer"
                                    >
                                        <option value="disabled">Disabled</option>
                                        <option value="system">System Proxy</option>
                                        <option value="socks5">SOCKS5 Proxy</option>
                                        <option value="http">HTTP Proxy</option>
                                    </select>
                                </div>

                                {/* Proxy Host & Port (shown for socks5/http) */}
                                {(proxyMode === 'socks5' || proxyMode === 'http') && (
                                    <>
                                        <div className="flex items-center gap-2 p-3 rounded-lg bg-telegram-hover/50">
                                            <div className="flex-1">
                                                <p className="text-xs text-telegram-subtext mb-1">Host</p>
                                                <input
                                                    type="text"
                                                    value={proxyHost}
                                                    onChange={e => setProxyHost(e.target.value)}
                                                    placeholder="127.0.0.1"
                                                    className="w-full bg-telegram-bg border border-telegram-border rounded-md px-2 py-1.5 text-sm text-telegram-text placeholder:text-telegram-subtext/50 focus:outline-none focus:border-telegram-primary/50 transition"
                                                />
                                            </div>
                                            <div className="w-24">
                                                <p className="text-xs text-telegram-subtext mb-1">Port</p>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="65535"
                                                    value={proxyPort}
                                                    onChange={e => setProxyPort(e.target.value)}
                                                    placeholder={proxyMode === 'socks5' ? '1080' : '7890'}
                                                    className="w-full bg-telegram-bg border border-telegram-border rounded-md px-2 py-1.5 text-sm text-telegram-text text-center focus:outline-none focus:border-telegram-primary/50 transition"
                                                />
                                            </div>
                                        </div>

                                        {/* Username & Password (optional) */}
                                        <div className="flex items-center gap-2 p-3 rounded-lg bg-telegram-hover/50">
                                            <div className="flex-1">
                                                <p className="text-xs text-telegram-subtext mb-1">Username <span className="opacity-60">(optional)</span></p>
                                                <input
                                                    type="text"
                                                    value={proxyUsername}
                                                    onChange={e => setProxyUsername(e.target.value)}
                                                    placeholder="username"
                                                    className="w-full bg-telegram-bg border border-telegram-border rounded-md px-2 py-1.5 text-sm text-telegram-text placeholder:text-telegram-subtext/50 focus:outline-none focus:border-telegram-primary/50 transition"
                                                />
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-xs text-telegram-subtext mb-1">Password <span className="opacity-60">(optional)</span></p>
                                                <input
                                                    type="password"
                                                    value={proxyPassword}
                                                    onChange={e => setProxyPassword(e.target.value)}
                                                    placeholder={proxyHasPassword ? '••••••••' : 'password'}
                                                    className="w-full bg-telegram-bg border border-telegram-border rounded-md px-2 py-1.5 text-sm text-telegram-text placeholder:text-telegram-subtext/50 focus:outline-none focus:border-telegram-primary/50 transition"
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}

                                {/* System proxy info */}
                                {proxyMode === 'system' && (
                                    <div className="p-3 rounded-lg bg-telegram-hover/50">
                                        <p className="text-xs text-telegram-subtext">
                                            Automatically uses your OS proxy settings (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY environment variables or system configuration).
                                        </p>
                                    </div>
                                )}

                                {/* Save Button */}
                                {proxyMode !== 'disabled' && (
                                    <div className="flex justify-end">
                                        <button
                                            onClick={handleProxySave}
                                            disabled={proxyLoading}
                                            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-telegram-primary text-white hover:bg-telegram-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {proxyLoading ? 'Saving...' : 'Apply Proxy'}
                                        </button>
                                    </div>
                                )}
                                {proxyMode === 'disabled' && proxyHasPassword && (
                                    <div className="flex justify-end">
                                        <button
                                            onClick={handleProxySave}
                                            disabled={proxyLoading}
                                            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
                                        >
                                            {proxyLoading ? 'Disabling...' : 'Disable Proxy'}
                                        </button>
                                    </div>
                                )}
                            </section>

                            {/* REST API Section */}
                            <section className="space-y-3">
                                <h3 className="text-xs font-semibold text-telegram-subtext uppercase tracking-wider flex items-center gap-2">
                                    <Globe className="w-3.5 h-3.5" />
                                    REST API
                                </h3>

                                {/* Enable Toggle */}
                                <div className="flex items-center justify-between p-3 rounded-lg bg-telegram-hover/50">
                                    <div className="flex items-center gap-2">
                                        <div className={`w-2 h-2 rounded-full ${apiSettings.running ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.5)]' : 'bg-gray-500'}`} />
                                        <div>
                                            <p className="text-sm text-telegram-text font-medium">Enable API Server</p>
                                            <p className="text-xs text-telegram-subtext">
                                                {apiSettings.running ? `Running on port ${apiSettings.port}` : 'Localhost only (127.0.0.1)'}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={handleApiToggle}
                                        disabled={apiLoading}
                                        className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${apiSettings.enabled ? 'bg-telegram-primary' : 'bg-telegram-border'} disabled:opacity-50`}
                                    >
                                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200 ${apiSettings.enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                                    </button>
                                </div>

                                {/* Port */}
                                <div className="flex items-center justify-between p-3 rounded-lg bg-telegram-hover/50">
                                    <div>
                                        <p className="text-sm text-telegram-text font-medium">Port</p>
                                        <p className="text-xs text-telegram-subtext">1024 - 65535</p>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min="1024"
                                            max="65535"
                                            value={apiPort}
                                            onChange={e => setApiPort(e.target.value)}
                                            onBlur={handlePortApply}
                                            onKeyDown={e => { if (e.key === 'Enter') handlePortApply(); }}
                                            className="w-20 bg-telegram-bg border border-telegram-border rounded-md px-2 py-1 text-sm text-telegram-text text-center focus:outline-none focus:border-telegram-primary/50 transition"
                                        />
                                    </div>
                                </div>

                                {/* API Key */}
                                <div className="p-3 rounded-lg bg-telegram-hover/50 space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <Key className="w-4 h-4 text-telegram-subtext" />
                                            <div>
                                                <p className="text-sm text-telegram-text font-medium">API Key</p>
                                                <p className="text-xs text-telegram-subtext">
                                                    {apiSettings.key_set ? 'Key configured' : 'No key set'}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={handleGenerateKey}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-telegram-primary/10 text-telegram-primary hover:bg-telegram-primary/20 transition"
                                        >
                                            <RefreshCw className="w-3 h-3" />
                                            {apiSettings.key_set ? 'Regenerate' : 'Generate'}
                                        </button>
                                    </div>

                                    {/* One-time key reveal */}
                                    {generatedKey && (
                                        <div className="mt-2 p-2.5 bg-telegram-bg rounded-lg border border-yellow-500/20">
                                            <p className="text-[10px] text-yellow-400/80 uppercase tracking-wider font-semibold mb-1.5">
                                                Copy now — this key will not be shown again
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 text-xs text-telegram-text font-mono bg-telegram-hover rounded px-2 py-1.5 overflow-x-auto select-all">
                                                    {generatedKey}
                                                </code>
                                                <button
                                                    onClick={handleCopyKey}
                                                    className="p-1.5 rounded-md hover:bg-telegram-hover text-telegram-subtext hover:text-telegram-text transition flex-shrink-0"
                                                    title="Copy to clipboard"
                                                >
                                                    {keyCopied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </section>

                            {/* Storage Section */}
                            <section className="space-y-3">
                                <h3 className="text-xs font-semibold text-telegram-subtext uppercase tracking-wider flex items-center gap-2">
                                    <HardDrive className="w-3.5 h-3.5" />
                                    Storage
                                </h3>

                                <div className="flex items-center justify-between p-3 rounded-lg bg-telegram-hover/50">
                                    <div className="flex items-center gap-2">
                                        <Trash2 className="w-4 h-4 text-telegram-subtext" />
                                        <div>
                                            <p className="text-sm text-telegram-text font-medium">Clear Local Cache</p>
                                            <p className="text-xs text-telegram-subtext">Remove cached previews and temp files</p>
                                        </div>
                                    </div>
                                    <button
                                        disabled={clearing}
                                        onClick={async () => {
                                            const ok = await confirm({
                                                title: 'Clear Cache',
                                                message: 'This will remove all cached previews and temporary files. Your uploaded files on Telegram are not affected.',
                                                confirmText: 'Clear',
                                                variant: 'danger',
                                            });
                                            if (!ok) return;
                                            setClearing(true);
                                            try {
                                                await invoke('cmd_clean_cache');
                                                toast.success('Cache cleared successfully');
                                            } catch {
                                                toast.error('Failed to clear cache');
                                            } finally {
                                                setClearing(false);
                                            }
                                        }}
                                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {clearing ? 'Clearing...' : 'Clear'}
                                    </button>
                                </div>
                            </section>
                        </div>

                        {/* Footer */}
                        <div className="px-5 py-3 border-t border-telegram-border flex items-center justify-between">
                            <button
                                onClick={resetSettings}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-telegram-subtext hover:text-red-400 hover:bg-red-500/10 transition font-medium"
                            >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Reset to Defaults
                            </button>
                            <button
                                onClick={onClose}
                                className="px-4 py-1.5 rounded-lg text-xs font-medium bg-telegram-primary text-white hover:bg-telegram-primary/90 transition"
                            >
                                Done
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
