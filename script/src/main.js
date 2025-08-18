import Tracker from "./tracker.js";
import Audio from "./audio.js";
import UI from "./ui/ui.js"
import Host from "./host.js";
import Settings from "./settings.js";
import App from "./app.js";
import Editor from "./editor.js";
import ModalDialog from "./ui/components/modalDialog.js";

var Main = function(){
    var me = {};

    me.init = function(){
        console.log("initialising");
        Host.init();
        Tracker.init();
        Audio.init();

        //UI.startMeasure();
        UI.init(function(){
            window.focus();
            me.isBrowserSupported = Audio.context && window.requestAnimationFrame;
            if (!me.isBrowserSupported){
                console.error("Browser not supported");
                var dialog = ModalDialog();
                dialog.setProperties({
                    width: UI.mainPanel.width,
                    height: UI.mainPanel.height,
                    top: 0,
                    left: 0,
                    ok:true
                });
                dialog.onDown = function(){window.location.href="https://www.google.com/chrome/"};
                dialog.setText("Sorry//Your browser does not support WebAudio//Supported browsers are/Chrome,Firefox,Safari and Edge");
    
                UI.setModalElement(dialog);
            }else{
                Settings.readSettings();
                //if (debug) UI.measure("Read & Apply Settings");
                App.init();
                Host.signalReady();
                // Explicit readiness signal to embedding host (iframe parent)
                try { window.parent && window.parent !== window && window.parent.postMessage({ type: 'bt-ready' }, '*'); } catch(_) {}
                try { console.log('[BT bootstrap] Host.useInitialLoad=', Host.useInitialLoad); } catch(_){ }
                if (Host.useInitialLoad) {
                    Editor.loadInitialFile();
                } else {
                    try { console.log('[BT bootstrap] Initial demo suppressed'); } catch(_){ }
                }
                //if (debug) UI.endMeasure();
            }
        });


    };

    return me;
}();

Main.init();

// Expose a minimal global API for host integrations (without changing UI behavior)
try {
    if (!window.BassoonTracker) {
        window.BassoonTracker = {
            // Loading
            load: (url, skipHistory, next, initial, silent) => Tracker.load(url, skipHistory, next, initial, silent),
            // Playback control
            playSong: () => Tracker.playSong(),
            stop: () => Tracker.stop(),
            togglePlay: () => Tracker.togglePlay(),
            isPlaying: () => Tracker.isPlaying(),
            // State
            getSong: () => Tracker.getSong(),
            getInstruments: () => Tracker.getInstruments(),
            setCurrentSongPosition: (pos) => Tracker.setCurrentSongPosition(pos),
            // Tempo controls
            setBPM: (bpm) => Tracker.setBPM(bpm),
            getBPM: () => Tracker.getBPM(),
            setAmigaSpeed: (speed) => Tracker.setAmigaSpeed(speed),
            getAmigaSpeed: () => Tracker.getAmigaSpeed(),
            // Audio access
            audio: Audio
        };

        // Advanced host APIs (non-breaking): allow raw ArrayBuffer loading post-init
        if (!window.BassoonTracker.loadModuleBuffer) {
            window.BassoonTracker.loadModuleBuffer = async function(arrayBuffer, filename){
                try {
                    if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error('Expected ArrayBuffer');
                    console.log('[BT API] loadModuleBuffer start', {filename, size: arrayBuffer.byteLength});
                    // Call Tracker.processFile directly with ArrayBuffer, filename, and empty URL
                    console.log('[BT API] calling Tracker.processFile', {bufferType: typeof arrayBuffer, bufferSize: arrayBuffer.byteLength, filename});
                    // Directly call internal Tracker.processFile path
                    return new Promise(res=>{
                        Tracker.processFile(arrayBuffer, filename || 'module.mod', '').then(fileType => {
                            console.log('[BT API] loadModuleBuffer complete', {filename, fileType});
                            res(fileType !== undefined);
                        }).catch(e => {
                            console.error('[BT API] Tracker.processFile failed', e);
                            res(false);
                        });
                    });
                } catch(e){ console.error('[BassoonTracker] loadModuleBuffer failed', e); return false; }
            };
        }

        // FileIOService integration: load files directly from parent's file service
        if (!window.BassoonTracker.loadFromFileService) {
            window.BassoonTracker.loadFromFileService = async function(filePath, filename){
                try {
                    console.log('[BT API] loadFromFileService start', {filePath, filename});
                    
                    // Access parent's FileIOService (available globally)
                    const fileManager = window.parent?.serviceContainer?.get?.('fileManager') || 
                                       window.parent?.fileManager || 
                                       window.serviceContainer?.get?.('fileManager') ||
                                       window.fileManager;
                    
                    if (!fileManager) {
                        throw new Error('FileManager not accessible from BassoonTracker iframe');
                    }
                    
                    // Load file using the parent's file service
                    const fileRecord = await fileManager.loadFile(filePath);
                    if (!fileRecord) {
                        throw new Error(`File not found: ${filePath}`);
                    }
                    
                    // Extract content and convert to ArrayBuffer
                    let content = fileRecord.fileContent ?? fileRecord.content;
                    console.log('[BT API] file content debug', {
                        contentType: typeof content,
                        isString: typeof content === 'string',
                        length: content?.length,
                        firstChars: typeof content === 'string' ? content.substring(0, 50) : 'not string',
                        hasContent: !!content,
                        fileRecordKeys: Object.keys(fileRecord)
                    });
                    
                    if (typeof content === 'string') {
                        // Base64 decode
                        try {
                            const bin = atob(content);
                            const arr = new Uint8Array(bin.length);
                            for(let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
                            content = arr.buffer;
                            console.log('[BT API] base64 decode success', {decodedSize: content.byteLength});
                        } catch (decodeError) {
                            console.error('[BT API] base64 decode failed', decodeError);
                            throw new Error(`Base64 decode failed: ${decodeError.message}`);
                        }
                    }
                    
                    if (!(content instanceof ArrayBuffer) || content.byteLength === 0) {
                        console.error('[BT API] invalid content after processing', {
                            isArrayBuffer: content instanceof ArrayBuffer,
                            byteLength: content?.byteLength,
                            type: typeof content
                        });
                        throw new Error('Invalid file content or empty file');
                    }
                    
                    // Use the existing processFile method with proper URL for UI refresh
                    const finalFilename = filename || fileRecord.filename || 'module.mod';
                    console.log('[BT API] calling Tracker.processFile directly for better UI refresh', {
                        filePath, 
                        providedFilename: filename,
                        fileRecordFilename: fileRecord.filename,
                        finalFilename,
                        contentSize: content.byteLength
                    });
                    
                    try {
                        // Instead of using processFile directly, create a blob URL and use normal Tracker.load
                        // This ensures we get all the normal callback behavior including demo loading
                        const blob = new Blob([content], {type: 'application/octet-stream'});
                        const tempUrl = URL.createObjectURL(blob) + (finalFilename ? ('#' + encodeURIComponent(finalFilename)) : '');
                        
                        console.log('[BT API] Created temporary blob URL for normal Tracker.load flow', {
                            filePath, 
                            finalFilename,
                            tempUrl,
                            contentSize: content.byteLength
                        });
                        
                        // Use the normal Tracker.load which includes all callback logic
                        const result = await new Promise((resolve, reject) => {
                            Tracker.load(tempUrl, true, (fileType) => {
                                console.log('[BT API] Normal Tracker.load complete', {filename: finalFilename, fileType});
                                console.log('[BT API] FILETYPE debug', {
                                    fileType, 
                                    windowFILETYPE: typeof window.FILETYPE !== 'undefined' ? window.FILETYPE : 'undefined',
                                    moduleValue: typeof window.FILETYPE !== 'undefined' ? window.FILETYPE.module : 'undefined'
                                });
                                
                                // Manually trigger demo loading if this was a module (check multiple possible values)
                                // Module files typically have fileType = 1
                                const isModule = fileType === 1 || (typeof window.FILETYPE !== 'undefined' && fileType === window.FILETYPE.module);
                                if (fileType && isModule) {
                                    console.log('[BT API] Module loaded via loadFromFileService, triggering demo list load');
                                    try {
                                        // Try multiple ways to access Host and Tracker
                                        let Host = window.Host;
                                        let TrackerModule = window.Tracker;
                                        
                                        // Fallback to global references that might be available
                                        if (!TrackerModule && typeof Tracker !== 'undefined') TrackerModule = Tracker;
                                        
                                        console.log('[BT API] Module access debug', {
                                            windowHost: !!window.Host,
                                            windowTracker: !!window.Tracker,
                                            globalTrackerCap: typeof Tracker !== 'undefined',
                                            finalHost: !!Host,
                                            finalTracker: !!TrackerModule
                                        });
                                        
                                        if (TrackerModule && typeof TrackerModule.load === 'function') {
                                            // Build demo URL using current location since Host might not be available
                                            let demoUrl;
                                            if (Host && typeof Host.getRemoteUrl === 'function') {
                                                demoUrl = Host.getRemoteUrl() + 'playlists/demosongs.json';
                                                console.log('[BT API] Using Host.getRemoteUrl for demo loading:', demoUrl);
                                            } else {
                                                // Fallback: construct URL from current location
                                                const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/');
                                                demoUrl = baseUrl + 'playlists/demosongs.json';
                                                console.log('[BT API] Using fallback URL construction for demo loading:', demoUrl);
                                            }
                                            
                                            console.log('[BT API] Loading demo playlist from', demoUrl);
                                            TrackerModule.load(demoUrl, true, null, false, true);
                                        } else {
                                            console.warn('[BT API] Could not access Tracker for demo loading', {Host: !!Host, TrackerModule: !!TrackerModule, loadMethod: TrackerModule && typeof TrackerModule.load});
                                        }
                                    } catch(demoError) {
                                        console.warn('[BT API] Demo list loading failed', demoError);
                                        // Don't fail the main load if demo loading fails
                                    }
                                } else {
                                    console.log('[BT API] File was not detected as module, skipping demo load', {fileType, isModule});
                                }
                                
                                // Clean up the blob URL
                                try {
                                    URL.revokeObjectURL(tempUrl);
                                } catch(e) {
                                    console.warn('[BT API] Failed to revoke blob URL', e);
                                }
                                
                                resolve(fileType !== undefined);
                            }, false, false); // not initial, not silent
                        });
                        
                        return result;
                    } catch(e) {
                        console.error('[BT API] Blob URL approach failed, falling back to processFile', e);
                        
                        // Fallback to direct processFile approach
                        const result = await new Promise((resolve, reject) => {
                            Tracker.processFile(content, finalFilename, filePath).then(fileType => {
                                console.log('[BT API] Fallback processFile complete', {filename: finalFilename, fileType});
                                resolve(fileType !== undefined);
                            }).catch(e => {
                                console.error('[BT API] Fallback processFile failed', e);
                                resolve(false);
                            });
                        });
                        return result;
                    }
                    
                    console.log('[BT API] loadFromFileService complete', {filePath, filename, size: content.byteLength});
                    return result;
                    
                } catch(e){ 
                    console.error('[BassoonTracker] loadFromFileService failed', e); 
                    return false; 
                }
            };
        }

        // Let host disable initial demo autoload before Editor.loadInitialFile runs
        window.BassoonTracker.disableInitialDemo = function(){
            try { (Host.disableInitialLoad||(()=>{Host.useInitialLoad=false;}))(); } catch(_){}
        // Allow host to request an explicit ready signal resend
        window.BassoonTracker._emitReady = function(){
            try { window.parent && window.parent !== window && window.parent.postMessage({ type: 'bt-ready', manual:true }, '*'); } catch(_) {}
        };
        // Flag for polling hosts and emit secondary ready message
        try {
            window.__BT_API_READY = Date.now();
            window.parent && window.parent !== window && window.parent.postMessage({ type: 'bt-api-ready' }, '*');
        } catch(_) {}
        };
    }
} catch (_) {}