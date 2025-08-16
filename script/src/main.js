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
                    
                    // Use the existing loadModuleBuffer method
                    const finalFilename = filename || fileRecord.filename || 'module.mod';
                    console.log('[BT API] calling loadModuleBuffer', {
                        filePath, 
                        providedFilename: filename,
                        fileRecordFilename: fileRecord.filename,
                        finalFilename,
                        contentSize: content.byteLength
                    });
                    const result = await window.BassoonTracker.loadModuleBuffer(content, finalFilename);
                    
                    // Trigger UI refresh to update display elements after file load
                    // Use a small delay to ensure the module is fully processed
                    setTimeout(() => {
                        try {
                            // Try to refresh the tracker info specifically instead of full screen refresh
                            if (window.BassoonTracker && window.BassoonTracker.refreshUI) {
                                window.BassoonTracker.refreshUI();
                            } else if (typeof EventBus !== 'undefined' && EVENT && EVENT.screenRefresh) {
                                EventBus.trigger(EVENT.screenRefresh);
                            }
                            console.log('[BT API] UI refresh triggered after file load');
                        } catch(e) {
                            console.warn('[BT API] UI refresh failed', e);
                        }
                    }, 100);
                    
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