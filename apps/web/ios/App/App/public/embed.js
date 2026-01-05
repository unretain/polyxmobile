/**
 * PolyxChart Embed SDK
 * Easily embed 3D Solana token charts on your website
 *
 * Usage:
 * <div id="polyx-chart"></div>
 * <script src="https://polyx.xyz/embed.js"></script>
 * <script>
 *   PolyxChart.render({
 *     container: '#polyx-chart',
 *     token: 'So11111111111111111111111111111111111111112',
 *     theme: 'dark',
 *     timeframe: '1h',
 *     width: '100%',
 *     height: 500
 *   });
 * </script>
 */

(function(window) {
  'use strict';

  const POLYX_BASE_URL = 'https://polyx.xyz';

  const PolyxChart = {
    version: '1.0.0',

    /**
     * Render a 3D chart
     * @param {Object} options - Configuration options
     * @param {string} options.container - CSS selector or DOM element
     * @param {string} options.token - Solana token mint address
     * @param {string} [options.theme='dark'] - 'dark' or 'light'
     * @param {string} [options.timeframe='1h'] - '1m', '5m', '15m', '1h', '4h', '1d'
     * @param {string|number} [options.width='100%'] - Width (CSS value or pixels)
     * @param {number} [options.height=500] - Height in pixels
     * @param {boolean} [options.header=true] - Show token info header
     * @param {boolean} [options.controls=true] - Show orbit controls
     * @param {Function} [options.onLoad] - Callback when chart loads
     * @param {Function} [options.onError] - Callback on error
     */
    render: function(options) {
      // Validate required options
      if (!options.container) {
        console.error('[PolyxChart] container is required');
        return null;
      }
      if (!options.token) {
        console.error('[PolyxChart] token address is required');
        return null;
      }

      // Get container element
      const container = typeof options.container === 'string'
        ? document.querySelector(options.container)
        : options.container;

      if (!container) {
        console.error('[PolyxChart] Container element not found:', options.container);
        return null;
      }

      // Default options
      const config = {
        theme: options.theme || 'dark',
        timeframe: options.timeframe || '1h',
        width: options.width || '100%',
        height: options.height || 500,
        header: options.header !== false,
        controls: options.controls !== false
      };

      // Build embed URL
      const embedUrl = new URL(`${POLYX_BASE_URL}/embed/${options.token}`);
      embedUrl.searchParams.set('theme', config.theme);
      embedUrl.searchParams.set('timeframe', config.timeframe);
      embedUrl.searchParams.set('header', config.header.toString());
      embedUrl.searchParams.set('controls', config.controls.toString());

      // Create iframe
      const iframe = document.createElement('iframe');
      iframe.src = embedUrl.toString();
      iframe.width = typeof config.width === 'number' ? `${config.width}px` : config.width;
      iframe.height = `${config.height}px`;
      iframe.frameBorder = '0';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope';
      iframe.style.cssText = 'border: none; border-radius: 8px; display: block;';

      // Loading state
      iframe.style.opacity = '0';
      iframe.style.transition = 'opacity 0.3s ease';

      // Clear container and append iframe
      container.innerHTML = '';
      container.appendChild(iframe);

      // Handle load event
      iframe.onload = function() {
        iframe.style.opacity = '1';
        if (typeof options.onLoad === 'function') {
          options.onLoad(iframe);
        }
      };

      // Handle error
      iframe.onerror = function(error) {
        console.error('[PolyxChart] Failed to load chart:', error);
        if (typeof options.onError === 'function') {
          options.onError(error);
        }
      };

      // Return instance for chaining
      return {
        iframe: iframe,
        container: container,
        config: config,

        /**
         * Update chart theme
         * @param {string} theme - 'dark' or 'light'
         */
        setTheme: function(theme) {
          const url = new URL(iframe.src);
          url.searchParams.set('theme', theme);
          iframe.src = url.toString();
          this.config.theme = theme;
          return this;
        },

        /**
         * Update chart timeframe
         * @param {string} timeframe - '1m', '5m', '15m', '1h', '4h', '1d'
         */
        setTimeframe: function(timeframe) {
          const url = new URL(iframe.src);
          url.searchParams.set('timeframe', timeframe);
          iframe.src = url.toString();
          this.config.timeframe = timeframe;
          return this;
        },

        /**
         * Change displayed token
         * @param {string} tokenAddress - Solana token mint address
         */
        setToken: function(tokenAddress) {
          const url = new URL(iframe.src);
          const pathParts = url.pathname.split('/');
          pathParts[pathParts.length - 1] = tokenAddress;
          url.pathname = pathParts.join('/');
          iframe.src = url.toString();
          return this;
        },

        /**
         * Resize the chart
         * @param {string|number} width - Width value
         * @param {number} height - Height in pixels
         */
        resize: function(width, height) {
          if (width !== undefined) {
            iframe.width = typeof width === 'number' ? `${width}px` : width;
            this.config.width = width;
          }
          if (height !== undefined) {
            iframe.height = `${height}px`;
            this.config.height = height;
          }
          return this;
        },

        /**
         * Destroy the chart
         */
        destroy: function() {
          if (container.contains(iframe)) {
            container.removeChild(iframe);
          }
          return null;
        }
      };
    },

    /**
     * Create multiple charts at once
     * @param {Array} charts - Array of chart configurations
     * @returns {Array} Array of chart instances
     */
    renderAll: function(charts) {
      if (!Array.isArray(charts)) {
        console.error('[PolyxChart] renderAll expects an array of configurations');
        return [];
      }
      return charts.map(function(config) {
        return PolyxChart.render(config);
      }).filter(Boolean);
    },

    /**
     * Get supported timeframes
     * @returns {Array} List of supported timeframe values
     */
    getTimeframes: function() {
      return ['1m', '5m', '15m', '1h', '4h', '1d', '1w', '1M'];
    },

    /**
     * Get supported themes
     * @returns {Array} List of supported theme values
     */
    getThemes: function() {
      return ['dark', 'light'];
    }
  };

  // Expose to global scope
  window.PolyxChart = PolyxChart;

  // AMD support
  if (typeof define === 'function' && define.amd) {
    define('PolyxChart', [], function() {
      return PolyxChart;
    });
  }

  // CommonJS support
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PolyxChart;
  }

})(typeof window !== 'undefined' ? window : this);
