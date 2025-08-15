// HostIntegration provider: allows an embedding host to override resize viewport and file save behaviors.
// Defaults preserve legacy behavior (window-based sizing and anchor-based file save).

const HostIntegration = {
  _overrides: {},

  // Allow host to provide overrides at runtime
  set(overrides) {
    try {
      if (overrides && typeof overrides === 'object') {
        Object.assign(this._overrides, overrides);
      }
    } catch (_) {}
  },

  // Viewport provider returning CSS pixel sizes and devicePixelRatio (optional)
  getViewportSize() {
    try {
      if (typeof this._overrides.getViewportSize === 'function') {
        const v = this._overrides.getViewportSize();
        if (v && typeof v.width === 'number' && typeof v.height === 'number') return v;
      }
    } catch (_) {}
    return {
      width: (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 800,
      height: (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 600,
      dpr: (typeof window !== 'undefined' && window.devicePixelRatio) ? window.devicePixelRatio : 1
    };
  },

  // Clamp a requested size to host constraints (default: window bounds)
  clampSize(width, height) {
    const vp = this.getViewportSize();
    const w = Math.min(width, vp.width);
    const h = Math.min(height, vp.height);
    return { width: w, height: h };
  },

  // File save hook: host can intercept; default saves via anchor download
  saveFile(blob, filename) {
    try {
      if (typeof this._overrides.saveFile === 'function') {
        const handled = this._overrides.saveFile(blob, filename);
        if (handled) return true;
      }
    } catch (_) {}
    try {
      const a = document.createElement('a');
      document.body.appendChild(a);
      a.style.display = 'none';
      const url = window.URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
      return true;
    } catch (_) {
      return false;
    }
  }
};

// Expose globally for non-module hosts to override easily
try { window.BassoonHost = HostIntegration; } catch (_) {}

export default HostIntegration;
