/**
 * SplatHandler Component - Robust Version
 * 
 * Performance & Stability:
 * - Fixes "Nothing Loading": Uses stable THREE.js import instead of prototype hacks.
 * - Fixes "Drag & Drop Gone": Uses a persistent drop-zone trigger to avoid display:none blocking.
 * - Optimized HUD: Passive DOM updates for smooth Obsidian performance.
 * - Smart Zoom (0.35x): Balanced zoom to frame objects immediately.
 */
async function View({ folderPath, defaultModel }) {
    const { useState, useEffect, useRef } = dc;

    const { loadScript } = await dc.require(folderPath + "/src/utils/LoadScriptUpgrade.js");

    /**
     * Passive HUD: Updates DOM directly to avoid React render lag in Obsidian.
     */
    function CameraHUD({ viewer }) {
        const hudRef = useRef(null);
        useEffect(() => {
            if (!viewer || !hudRef.current) return;
            const span = hudRef.current.querySelector('#cam-pos');
            let frameId;
            const update = () => {
                if (viewer.camera && span) {
                    const c = viewer.camera.position;
                    span.innerText = `${c.x.toFixed(1)}, ${c.y.toFixed(1)}, ${c.z.toFixed(1)}`;
                }
                frameId = requestAnimationFrame(update);
            };
            update();
            return () => cancelAnimationFrame(frameId);
        }, [viewer]);

        return (
            <div ref={hudRef} style={{ pointerEvents: 'none', userSelect: 'none' }}>
                <div>FPS: 60 (Est)</div>
                <div>CAM: <span id="cam-pos">0, 0, 0</span></div>
            </div>
        );
    }

    const FULLTAB_ID = 'fulltab-071-splathandler';

    function SplatViewer() {
        const rootRef = useRef(null);
        const viewerRef = useRef(null);
        const fileInputRef = useRef(null);
        const viewerInstanceRef = useRef(null);

        const [lib, setLib] = useState(null);
        const [three, setThree] = useState(null);
        const [status, setStatus] = useState("Initializing...");
        const [error, setError] = useState(null);
        const [plyUrl, setPlyUrl] = useState(defaultModel ? defaultModel.substring(defaultModel.lastIndexOf('/') + 1) : "LIVESTREAM_3D.ply");
        const [viewerInstance, setViewerInstance] = useState(null);
        const [isDragging, setIsDragging] = useState(false);
        const [autoRotate, setAutoRotate] = useState(false);
        const [splatSize, setSplatSize] = useState(1.0);
        const [hijacked, setHijacked] = useState(false);

        // Layer 1 — CSS suppression
        useEffect(() => {
            let styleEl = document.getElementById(FULLTAB_ID);
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = FULLTAB_ID;
                styleEl.innerHTML = `
                    /* FullTab: suppress all Obsidian chrome */
                    body > .app-container .status-bar,
                    .status-bar,
                    .inline-title,
                    .view-footer,
                    .workspace-leaf-content-footer,
                    .mod-footer,
                    .embedded-backlinks {
                        display: none !important;
                    }
                    .workspace-leaf-content,
                    .markdown-preview-view,
                    .cm-scroller {
                        overflow: hidden !important;
                        padding: 0 !important;
                        margin: 0 !important;
                        border-radius: 0 !important;
                    }
                    .markdown-preview-section {
                        padding: 0 !important;
                        max-width: 100% !important;
                    }
                    .markdown-preview-sizer {
                        padding: 0 !important;
                        margin: 0 auto !important;
                        min-height: unset !important;
                    }
                    @keyframes dc-spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(styleEl);
            }
            return () => {
                const el = document.getElementById(FULLTAB_ID);
                if (el) el.remove();
            };
        }, []);

        // Layer 2 — DOM Reparenting into .cm-scroller
        useEffect(() => {
            const root = rootRef.current;
            if (!root) return;

            let attempts = 0;
            const hijack = () => {
                try {
                    const leaf = root.closest('.workspace-leaf');
                    const scroller = leaf?.querySelector('.cm-scroller');
                    if (scroller) {
                        scroller.appendChild(root);
                        Object.assign(root.style, {
                            position: 'absolute',
                            top: '0', left: '0',
                            width: '100%', height: '100%',
                            zIndex: '10',
                            display: 'flex',
                            flexDirection: 'column',
                            overflow: 'hidden',
                            visibility: 'visible',
                        });
                        setHijacked(true);
                        return true;
                    }
                } catch (e) { /* leaf not ready yet */ }
                return false;
            };

            if (hijack()) return;

            const poller = setInterval(() => {
                if (hijack() || attempts++ > 100) clearInterval(poller);
            }, 16);

            return () => clearInterval(poller);
        }, []);

        // Load Dependencies
        useEffect(() => {
            let mounted = true;
            const loadDeps = async () => {
                try {
                    setStatus("Loading Engine...");
                    // Load THREE and Splat Library in parallel
                    const [THREE, GaussianSplats3D] = await Promise.all([
                        loadScript(dc, 'https://esm.sh/three@0.157.0', { type: 'module', cache: false }),
                        loadScript(dc, 'https://esm.sh/@mkkellogg/gaussian-splats-3d@0.4.7', { type: 'module', cache: false })
                    ]);

                    if (mounted) {
                        setThree(THREE);
                        setLib(GaussianSplats3D);
                        setStatus("Ready");
                    }
                } catch (err) {
                    if (mounted) { setStatus("Sync Error"); setError(err.message); }
                }
            };
            loadDeps();
            return () => { mounted = false; };
        }, []);

        // Auto-load defaultModel when lib is ready
        useEffect(() => {
            if (lib && defaultModel) {
                loadSplat(defaultModel, defaultModel.substring(defaultModel.lastIndexOf('/') + 1));
            }
        }, [lib, defaultModel]);

        const handleAutoCenter = (inst) => {
            const activeViewer = inst || viewerInstance;
            if (!activeViewer || !activeViewer.splatMesh || !three) return;
            try {
                const mesh = activeViewer.splatMesh;
                const splatCount = typeof mesh.getSplatCount === 'function' ? mesh.getSplatCount() : 0;

                const center = new three.Vector3();
                let maxDim = 8.0;

                if (splatCount > 0) {
                    const sampleSize = Math.min(1000, splatCount);
                    const step = Math.max(1, Math.floor(splatCount / sampleSize));
                    const points = [];
                    let sumX = 0, sumY = 0, sumZ = 0;
                    
                    for (let i = 0; i < splatCount; i += step) {
                        const pt = new three.Vector3();
                        mesh.getSplatCenter(i, pt, true);
                        points.push(pt);
                        sumX += pt.x;
                        sumY += pt.y;
                        sumZ += pt.z;
                    }
                    
                    const count = points.length;
                    const meanX = sumX / count;
                    const meanY = sumY / count;
                    const meanZ = sumZ / count;
                    
                    const dists = points.map(pt => ({
                        pt,
                        dSq: Math.pow(pt.x - meanX, 2) + Math.pow(pt.y - meanY, 2) + Math.pow(pt.z - meanZ, 2)
                    }));
                    dists.sort((a, b) => a.dSq - b.dSq);
                    
                    const keepCount = Math.floor(count * 0.7);
                    if (keepCount > 0) {
                        let filteredSumX = 0, filteredSumY = 0, filteredSumZ = 0;
                        let minX = Infinity, maxX = -Infinity;
                        let minY = Infinity, maxY = -Infinity;
                        let minZ = Infinity, maxZ = -Infinity;
                        
                        for (let i = 0; i < keepCount; i++) {
                            const p = dists[i].pt;
                            filteredSumX += p.x;
                            filteredSumY += p.y;
                            filteredSumZ += p.z;
                            
                            if (p.x < minX) minX = p.x;
                            if (p.x > maxX) maxX = p.x;
                            if (p.y < minY) minY = p.y;
                            if (p.y > maxY) maxY = p.y;
                            if (p.z < minZ) minZ = p.z;
                            if (p.z > maxZ) maxZ = p.z;
                        }
                        
                        center.set(filteredSumX / keepCount, filteredSumY / keepCount, filteredSumZ / keepCount);
                        const sizeX = maxX - minX;
                        const sizeY = maxY - minY;
                        const sizeZ = maxZ - minZ;
                        maxDim = Math.max(sizeX, sizeY, sizeZ);
                    } else {
                        center.set(meanX, meanY, meanZ);
                    }
                } else {
                    const box = mesh.computeBoundingBox(true, 0);
                    box.getCenter(center);
                    const size = new three.Vector3();
                    box.getSize(size);
                    maxDim = Math.max(size.x, size.y, size.z);
                }

                if (activeViewer.controls && activeViewer.camera) {
                    const distance = maxDim * 1.5 || 8.0;
                    activeViewer.camera.position.set(center.x, center.y + (maxDim * 0.2), center.z + distance);
                    activeViewer.controls.target.set(center.x, center.y, center.z);
                    activeViewer.controls.update();
                    setStatus("Centered");
                } else {
                    console.warn("[SplatHandler] Camera or controls missing from viewer instance!");
                }
            } catch (e) {
                console.warn("[SplatHandler] Auto-centering failed:", e);
                if (activeViewer.camera) activeViewer.camera.position.set(0, 2, 5);
            }
        };

        // Throttled Resize Observer
        useEffect(() => {
            if (!viewerRef.current) return;
            let resizeFrame;
            const resizeObserver = new ResizeObserver((entries) => {
                if (resizeFrame) cancelAnimationFrame(resizeFrame);
                resizeFrame = requestAnimationFrame(() => {
                    const w = viewerRef.current.clientWidth;
                    const h = viewerRef.current.clientHeight;
                    const inst = viewerInstanceRef.current;
                    if (w > 0 && h > 0 && inst && inst.renderer) {
                        inst.renderer.setSize(w, h);
                        inst.camera.aspect = w / h;
                        inst.camera.updateProjectionMatrix();
                    }
                });
            });
            resizeObserver.observe(viewerRef.current);
            return () => {
                resizeObserver.disconnect();
                if (resizeFrame) cancelAnimationFrame(resizeFrame);
            };
        }, []);

        // Auto Rotate Control
        useEffect(() => {
            if (!viewerInstance || !viewerInstance.controls) return;
            viewerInstance.controls.autoRotate = autoRotate;
            viewerInstance.controls.autoRotateSpeed = 4.0;
        }, [viewerInstance, autoRotate]);

        const loadSplat = async (url, fileName = "") => {
            if (!lib || !viewerRef.current) {
                console.warn("[SplatHandler] loadSplat cancelled: lib or viewerRef not ready", { hasLib: !!lib, hasRef: !!viewerRef.current });
                return;
            }
            try {
                setError(null);
                setStatus("Loading Splat...");
                if (fileName) {
                    setPlyUrl(fileName);
                }
                if (viewerInstance) {
                    try { viewerInstance.dispose(); } catch (e) { console.warn("Dispose error:", e); }
                }

                viewerRef.current.innerHTML = '';

                const viewer = new lib.Viewer({
                    'rootElement': viewerRef.current,
                    'cameraUp': [0, 1, 0],
                    'initialCameraPosition': [0, 2, 5],
                    'initialCameraLookAt': [0, 0, 0],
                    'antialiased': false,
                    'integerBasedDistancesComputation': true,
                    'dynamicScene': false,
                    'maxSceneCount': 1,
                    'gpuAcceleratedSort': false // Disabled to prevent silent WebGL compute shader failures in Obsidian
                });

                const name = (fileName || plyUrl || "").toLowerCase();
                let loadUrl = url;
                if (url.startsWith('blob:')) loadUrl = url + (name.endsWith('.splat') ? '#.splat' : '#.ply');

                let formatVal = lib.SceneFormat.Ply;
                if (name.endsWith('.splat')) {
                    formatVal = lib.SceneFormat.Splat;
                } else if (name.endsWith('.ksplat')) {
                    formatVal = lib.SceneFormat.KSplat;
                }

                await viewer.addSplatScene(loadUrl, {
                    'showLoadingUI': false, // Disabled default loading UI to use custom premium CSS loader
                    'rotation': [1, 0, 0, 0], // Revert to 180-deg flip on X-axis for correct orientation
                    'scale': [1, 1, 1],
                    'format': formatVal,
                    'streamView': false
                });

                viewer.start();

                setTimeout(() => {
                    // Force WebGL buffer resize immediately!
                    const w = viewerRef.current.clientWidth;
                    const h = viewerRef.current.clientHeight;
                    if (w > 0 && h > 0 && viewer.renderer) {
                        viewer.renderer.setSize(w, h);
                        if (viewer.camera) {
                            viewer.camera.aspect = w / h;
                            viewer.camera.far = 10000; // Prevent far-plane clipping
                            viewer.camera.updateProjectionMatrix();
                        }
                    }

                    handleAutoCenter(viewer);
                    viewerInstanceRef.current = viewer;
                    setViewerInstance(viewer);
                    setStatus("Active");
                }, 800);

            } catch (err) {
                setError(err.message);
                setStatus("Error");
            }
        };

        const adjustScale = (val) => {
            if (!viewerInstance || !viewerInstance.splatMesh) return;
            const next = splatSize * val;
            viewerInstance.splatMesh.scale.set(next, next, next);
            setSplatSize(next);
            setStatus(`Scale: ${next.toFixed(2)}x`);
        };

        return (
            <div ref={rootRef}
                onDragEnter={() => setIsDragging(true)}
                style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', minHeight: '600px', backgroundColor: 'var(--background-primary)', color: 'var(--text-normal)', borderRadius: '8px', overflow: 'hidden', position: 'relative', border: '1px solid var(--background-modifier-border)', visibility: hijacked ? 'visible' : 'hidden' }}>

                {/* Drag Overlay Trigger (Always present but transparent when not dragging) */}
                <div onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!isDragging) setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                        e.preventDefault(); e.stopPropagation(); setIsDragging(false);
                        const f = e.dataTransfer.files[0];
                        if (f) { setPlyUrl(f.name); loadSplat(URL.createObjectURL(f), f.name); }
                    }}
                    style={{
                        position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1000,
                        pointerEvents: isDragging ? 'auto' : 'none', // Block interaction only when dragging
                        backgroundColor: isDragging ? 'var(--background-modifier-hover)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', border: isDragging ? '6px dashed var(--interactive-accent)' : 'none'
                    }}>
                    {isDragging && <div style={{ backgroundColor: 'var(--background-secondary)', padding: '20px 40px', borderRadius: '10px', fontSize: '20px', fontWeight: 'bold' }}>DROP PLY HERE</div>}
                </div>

                {/* HUD */}
                {viewerInstance && (
                    <div style={{ position: 'absolute', top: '80px', right: '16px', zIndex: 100, backgroundColor: 'var(--background-secondary)', padding: '12px', borderRadius: '8px', fontSize: '11px', border: '1px solid var(--interactive-accent)', color: 'var(--text-normal)', fontFamily: 'monospace', minWidth: '160px' }}>
                        <div style={{ color: 'var(--interactive-accent)', fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid var(--background-modifier-border)' }}>DATA STATUS</div>
                        <CameraHUD viewer={viewerInstance} />
                        <button onClick={() => setAutoRotate(!autoRotate)} style={{ marginTop: '10px', width: '100%', backgroundColor: autoRotate ? 'var(--interactive-accent)' : 'var(--background-modifier-form-field)', padding: '8px', borderRadius: '4px', color: autoRotate ? 'var(--text-on-accent)' : 'var(--text-normal)', border: '1px solid var(--background-modifier-border)', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                            {autoRotate ? (
                                <>
                                    <dc.Icon icon="square" style={{ width: '12px', height: '12px' }} /> Stop Spin
                                </>
                            ) : (
                                <>
                                    <dc.Icon icon="rotate-cw" style={{ width: '12px', height: '12px' }} /> Spin View
                                </>
                            )}
                        </button>
                        <div style={{ marginTop: '10px', display: 'flex', gap: '4px' }}>
                            <button onClick={() => adjustScale(0.7)} style={{ flex: 1, backgroundColor: 'var(--background-modifier-form-field)', padding: '6px', color: 'var(--text-normal)', border: '1px solid var(--background-modifier-border)', cursor: 'pointer' }}>Size -</button>
                            <button onClick={() => adjustScale(1.4)} style={{ flex: 1, backgroundColor: 'var(--background-modifier-form-field)', padding: '6px', color: 'var(--text-normal)', border: '1px solid var(--background-modifier-border)', cursor: 'pointer' }}>Size +</button>
                        </div>
                    </div>
                )}

                {/* Header */}
                <div style={{ padding: '10px 15px', borderBottom: '1px solid var(--background-modifier-border)', display: 'flex', gap: '8px', alignItems: 'center', backgroundColor: 'var(--background-secondary)', zIndex: 50 }}>
                    <span style={{ fontSize: '14px', fontWeight: 'bold', color: 'var(--interactive-accent)' }}>SplatHandler</span>
                    <input type="text" value={plyUrl} readOnly style={{ flex: 1, backgroundColor: 'var(--background-modifier-form-field)', border: '1px solid var(--background-modifier-border)', color: 'var(--text-muted)', padding: '5px 8px', borderRadius: '4px', fontSize: '12px' }} />
                    <button onClick={() => {
                        const exampleUrl = "https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/bonsai-7k.splat";
                        setPlyUrl("bonsai-7k.splat");
                        loadSplat(exampleUrl, "bonsai-7k.splat");
                    }} style={{ backgroundColor: 'var(--background-modifier-form-field)', color: 'var(--text-normal)', border: '1px solid var(--background-modifier-border)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <dc.Icon icon="sparkles" style={{ width: '12px', height: '12px' }} /> Example
                    </button>
                    <button onClick={() => fileInputRef.current.click()} style={{ backgroundColor: 'var(--background-modifier-form-field)', color: 'var(--text-normal)', border: '1px solid var(--background-modifier-border)', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Open</button>
                    {viewerInstance && <button onClick={handleAutoCenter} style={{ backgroundColor: 'var(--interactive-accent)', color: 'var(--text-on-accent)', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Recenter</button>}
                </div>
                <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files[0]; if (f) { setPlyUrl(f.name); loadSplat(URL.createObjectURL(f), f.name); } }} accept=".ply,.splat" style={{ display: 'none' }} />

                <div style={{ padding: '4px 15px', backgroundColor: 'var(--background-primary)', fontSize: '10px', color: 'var(--text-muted)' }}>
                    {status} | GAUSSIAN_3D | Obsidian Ready
                </div>

                {/* Viewer Area */}
                <div style={{ flex: 1, position: 'relative', overflow: 'hidden', backgroundColor: 'var(--background-primary)', backgroundImage: 'radial-gradient(var(--background-modifier-border) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
                    {error && <div style={{ position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)', padding: '8px 20px', backgroundColor: 'var(--text-error)', color: 'var(--background-primary)', zIndex: 200, borderRadius: '4px' }}>{error}</div>}
                    <div ref={viewerRef} style={{ width: '100%', height: '100%' }} />
                    
                    {/* Premium Custom Glassmorphic Loading Overlay */}
                    {(status.includes('Loading') || status === "Initializing...") && !error && (
                        <div style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            backdropFilter: 'blur(8px)',
                            WebkitBackdropFilter: 'blur(8px)',
                            backgroundColor: 'rgba(0, 0, 0, 0.45)',
                            zIndex: 150,
                            transition: 'opacity 0.3s ease'
                        }}>
                            <div style={{
                                width: '48px',
                                height: '48px',
                                borderRadius: '50%',
                                border: '3px solid rgba(255, 255, 255, 0.1)',
                                borderTopColor: 'var(--interactive-accent)',
                                animation: 'dc-spin 1s cubic-bezier(0.5, 0.1, 0.4, 0.9) infinite',
                                marginBottom: '16px'
                            }} />
                            <div style={{
                                fontFamily: 'var(--font-interface, sans-serif)',
                                fontSize: '13px',
                                fontWeight: '500',
                                color: 'var(--text-normal)',
                                letterSpacing: '0.08em',
                                textTransform: 'uppercase',
                                opacity: 0.9
                            }}>
                                {status}
                            </div>
                        </div>
                    )}

                    {!viewerInstance && !status.includes('Loading') && status !== "Initializing..." && (
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', opacity: 0.4 }}>
                            <div style={{ fontSize: '24px', display: 'flex', justifyContent: 'center', marginBottom: '8px' }}>
                                <dc.Icon icon="box" style={{ width: '24px', height: '24px' }} />
                            </div>
                            <div style={{ fontSize: '12px' }}>Drag PLY to view</div>
                        </div>
                    )}
                </div>
            </div>
        );
    }
    return <SplatViewer />;
}
return { View };
