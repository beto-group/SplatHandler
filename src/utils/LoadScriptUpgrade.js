/**
 * Universal Script & Module Loader with ESM Support
 * ================================================
 * Loads scripts (classic or ESM modules) from URLs or local vault paths with caching.
 */

async function loadScript(dc, src, options = {}) {
  const {
    type = 'script',
    globalName = null,
    cache = true,
    cacheDir = null, // Custom cache directory
    onload = null,
    onerror = null
  } = options;

  if (!dc || !dc.app || !dc.app.vault || !dc.app.vault.adapter) {
    const error = new Error("Datacore context 'dc' with vault adapter is required for loadScript.");
    if (onerror) onerror(error);
    throw error;
  }

  const adapter = dc.app.vault.adapter;
  const resolvedCacheDir = cacheDir ? dc.resolvePath(cacheDir) : dc.resolvePath("_RESOURCES/DATACORE/_DONE/LOAD SCRIPT/data/cache/scripts");
  const isUrl = /^https?:\/\//.test(src);

  if (globalName && window[globalName]) {
    console.log(`[LoadScript] ✓ ${globalName} already available (skipping load)`);
    return type === 'module' ? window[globalName] : Promise.resolve();
  }

  window.__scriptPromises = window.__scriptPromises || {};
  const promiseKey = `${type}:${src}`;
  
  if (window.__scriptPromises[promiseKey]) {
    console.log(`[LoadScript] ⏳ ${src} already loading, reusing promise...`);
    return window.__scriptPromises[promiseKey];
  }

  console.log(`[LoadScript] 📥 Loading ${type} from ${isUrl ? 'URL' : 'local'}: ${src}`);

  const loadPromise = (async () => {
    try {
      let scriptContent = null;

      if (isUrl) {
        const safeFilename = src
          .replace(/^https?:\/\//, '')
          .replace(/[\/\\?%*:|"<>]/g, '_') + '.js';
        const cachePath = `${resolvedCacheDir}/${safeFilename}`;

        if (cache && await adapter.exists(cachePath)) {
          console.log(`[LoadScript] 📦 Loading from cache: ${cachePath}`);
          try {
            scriptContent = await adapter.read(cachePath);
          } catch (readError) {
            console.warn(`[LoadScript] ⚠️ Cache read failed, refetching:`, readError);
          }
        }

        if (scriptContent === null && cacheDir) {
          const defaultCacheDir = dc.resolvePath("_RESOURCES/DATACORE/_DONE/LOAD SCRIPT/data/cache/scripts");
          const defaultCachePath = `${defaultCacheDir}/${safeFilename}`;
          if (await adapter.exists(defaultCachePath)) {
            console.log(`[LoadScript] 🚚 Copying CDN file from default cache to custom location: ${cachePath}`);
            try {
              scriptContent = await adapter.read(defaultCachePath);
              if (!(await adapter.exists(resolvedCacheDir))) {
                await adapter.mkdir(resolvedCacheDir);
              }
              await adapter.write(cachePath, scriptContent);
            } catch (copyError) {
              console.warn(`[LoadScript] ⚠️ Copying default cache failed:`, copyError);
            }
          }
        }

        if (scriptContent === null && cache) {
          console.log(`[LoadScript] 🌐 Fetching from network: ${src}`);
          const response = await fetch(src);
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          scriptContent = await response.text();

          if (cache) {
            try {
              if (!(await adapter.exists(resolvedCacheDir))) {
                await adapter.mkdir(resolvedCacheDir);
              }
              console.log(`[LoadScript] 💾 Caching to: ${cachePath}`);
              await adapter.write(cachePath, scriptContent);
            } catch (writeError) {
              console.warn(`[LoadScript] ⚠️ Cache write failed:`, writeError);
            }
          }
        }
      } else {
        console.log(`[LoadScript] 📁 Reading from vault: ${src}`);
        if (!(await adapter.exists(src))) {
          throw new Error(`Local file not found: ${src}`);
        }
        scriptContent = await adapter.read(src);
      }

      let result;

      if (type === 'module') {
        console.log(`[LoadScript] 🎭 Loading as ESM module...`);
        
        try {
          let moduleExports;
          
          if (scriptContent) {
            console.log(`[LoadScript] 📦 Importing from blob URL...`);
            const blob = new Blob([scriptContent], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            
            try {
              moduleExports = await import(blobUrl);
            } finally {
              URL.revokeObjectURL(blobUrl);
            }
          } else if (isUrl) {
            console.log(`[LoadScript] 📦 Importing from URL directly: ${src}`);
            moduleExports = await import(src);
          } else {
            throw new Error("No script content available to construct module blob");
          }
          
          console.log(`[LoadScript] ✅ Module loaded successfully`);
          console.log(`[LoadScript] 📊 Exports:`, Object.keys(moduleExports));
          
          if (globalName) {
            window[globalName] = moduleExports;
            console.log(`[LoadScript] 🌍 Stored as window.${globalName}`);
          }
          
          result = moduleExports;
          
        } catch (importError) {
          throw new Error(`Module import failed: ${importError.message}`);
        }
        
      } else {
        console.log(`[LoadScript] 📜 Loading as classic script...`);
        
        const scriptElement = document.createElement('script');
        
        try {
          if (scriptContent) {
            scriptElement.textContent = scriptContent;
            document.body.appendChild(scriptElement);
            console.log(`[LoadScript] ✅ Script executed successfully`);
            
            if (globalName) {
              if (window[globalName]) {
                console.log(`[LoadScript] 🌍 window.${globalName} available`);
              } else {
                console.warn(`[LoadScript] ⚠️ Global "${globalName}" not found after load`);
              }
            }
            result = scriptElement;
          } else if (isUrl) {
            result = new Promise((resolve, reject) => {
              scriptElement.src = src;
              scriptElement.onload = () => {
                console.log(`[LoadScript] ✅ Script loaded from URL successfully`);
                if (globalName && window[globalName]) {
                  console.log(`[LoadScript] 🌍 window.${globalName} available`);
                }
                resolve(scriptElement);
              };
              scriptElement.onerror = (err) => {
                reject(new Error(`Failed to load script from URL: ${src}`));
              };
              document.body.appendChild(scriptElement);
            });
          } else {
            throw new Error("No script content available to load classic script");
          }
          
        } catch (execError) {
          console.error(`[LoadScript] ❌ Script execution failed:`, execError);
          if (scriptElement.parentNode) {
            scriptElement.parentNode.removeChild(scriptElement);
          }
          throw new Error(`Script execution failed: ${execError.message}`);
        }
      }

      if (onload) {
        onload(result);
      }

      console.log(`[LoadScript] 🎉 Load complete: ${src}`);
      return result;

    } catch (error) {
      console.error(`[LoadScript] 💥 Failed to load ${src}:`, error);
      if (onerror) onerror(error);
      throw error;
    } finally {
      delete window.__scriptPromises[promiseKey];
    }
  })();

  window.__scriptPromises[promiseKey] = loadPromise;
  return loadPromise;
}

async function loadMultiple(dc, scripts, parallel = false) {
  if (parallel) {
    return Promise.all(scripts.map(({ src, options }) => loadScript(dc, src, options)));
  } else {
    const results = [];
    for (const { src, options } of scripts) {
      results.push(await loadScript(dc, src, options));
    }
    return results;
  }
}

async function fetchAndCacheImage(dc, url) {
  const cacheDir = dc.resolvePath("_RESOURCES/DATACORE/_DONE/SPLAT HANDLER/data/cache/images");
  const adapter = dc.app.vault.adapter;

  const safeFilename = url.replace(/^https?:\/\//, '').replace(/[\/\\?%*:|"<>]/g, '_');
  const cachePath = `${cacheDir}/${safeFilename}`;

  if (await adapter.exists(cachePath)) {
    console.log(`[ImageCache] Loading from cache: ${cachePath}`);
    try {
      const binaryData = await adapter.readBinary(cachePath);
      const blob = new Blob([binaryData]);
      return URL.createObjectURL(blob);
    } catch (readError) {
      console.warn(`[ImageCache] Cache read failed, re-fetching:`, readError);
    }
  }

  console.log(`[ImageCache] Fetching: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }
  const blob = await response.blob();

  try {
    const buffer = await blob.arrayBuffer();
    if (!(await adapter.exists(cacheDir))) {
      await adapter.mkdir(cacheDir);
    }
    console.log(`[ImageCache] Caching to: ${cachePath}`);
    await adapter.writeBinary(cachePath, buffer);
  } catch (writeError) {
    console.warn(`[ImageCache] Cache write failed:`, writeError);
  }

  return URL.createObjectURL(blob);
}

return { loadScript, loadMultiple, fetchAndCacheImage };
