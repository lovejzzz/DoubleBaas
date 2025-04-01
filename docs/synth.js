document.addEventListener('DOMContentLoaded', () => {
    // --- Global References ---
    // Add a variable to store the MIDI access promise at the global scope
    let cachedMidiPromise = null;
    
    // UI Elements
    const startButton = document.getElementById('start-audio');
    const midiInputSelector = document.getElementById('midi-input');
    const midiLight = document.getElementById('midi-activity-light');
    
    // Global MIDI variables
    let midiAccess = null;
    let currentMidiInputId = null;
    let midiLightTimeout = null;
    
    // Store MIDI access promise to prevent multiple permission requests
    let midiAccessPromise = null;
    
    // Audio system flags
    let audioStarted = false;

    // --- Global References ---
    let vco1, vco2, vco1Gain, vco2Gain;
    let filterLp, filterHp, filterSweepXFade;
    let filterEnv, ampEnv;
    let lfo;
    let masterVolume;
    let currentNote = null; // Simple monophonic tracking
    const pitchBendRange = 2; // Semitones for pitch bend +/-
    let midiActivityLight = null; // Reference to MIDI activity indicator
    let midiLightTimeout = null; // For handling the light timeout
    const activeNotes = new Set();

    // LFO->Parameter Gain Nodes (for controlling modulation depth)
    let lfoFilterModGain, lfoVco1PwmGain, lfoVco2PwmGain, lfoVibratoGain;
    let filterEnvMod; // Declare filterEnvMod here

    // MIDI State
    let midiAccess = null; // Store MIDI access object
    let currentMidiInputId = null; // Store the ID of the selected input

    // === DOM Element References ===
    const startButton = document.getElementById('start-audio');
    const midiInputSelector = document.getElementById('midi-input');
    const masterVolumeSlider = document.getElementById('master-volume');
    const glideSlider = document.getElementById('glide');
    midiActivityLight = document.getElementById('midi-activity-light');

    // ... (rest of your DOM element references are fine) ...
    // VCO1
    const vco1WaveSelect = document.getElementById('vco1-wave');
    const vco1DetuneSlider = document.getElementById('vco1-detune');
    const vco1PwmDepthSlider = document.getElementById('vco1-pwm-depth');
    // VCO2
    const vco2WaveSelect = document.getElementById('vco2-wave');
    const vco2DetuneSlider = document.getElementById('vco2-detune');
    const vco2PwmDepthSlider = document.getElementById('vco2-pwm-depth');
    // Mixer
    const mixVco1Slider = document.getElementById('mix-vco1');
    const mixVco2Slider = document.getElementById('mix-vco2');
    // Filter
    const filterCutoffSlider = document.getElementById('filter-cutoff');
    const filterQSlider = document.getElementById('filter-q');
    const filterSweepSlider = document.getElementById('filter-sweep');
    const filterEnvAmtSlider = document.getElementById('filter-env-amt');
    const filterLfoAmtSlider = document.getElementById('filter-lfo-amt');
    // Filter Env
    const filterAttackSlider = document.getElementById('filter-attack');
    const filterDecaySlider = document.getElementById('filter-decay');
    const filterSustainSlider = document.getElementById('filter-sustain');
    const filterReleaseSlider = document.getElementById('filter-release');
    // Amp Env
    const ampAttackSlider = document.getElementById('amp-attack');
    const ampDecaySlider = document.getElementById('amp-decay');
    const ampSustainSlider = document.getElementById('amp-sustain');
    const ampReleaseSlider = document.getElementById('amp-release');
    // LFO
    const lfoWaveSelect = document.getElementById('lfo-wave');
    const lfoRateSlider = document.getElementById('lfo-rate');
    const lfoVibratoDepthSlider = document.getElementById('lfo-vibrato-depth');

    // Value display elements (map by ID for easier lookup)
    const displays = {};

    // Function to find and store all value displays
    function initializeDisplays() {
        const controlGroups = document.querySelectorAll('.control-group');
        controlGroups.forEach(group => {
            const input = group.querySelector('input, select');
            if (input && input.id) {
                const display = group.querySelector('.value-display');
                if (display) {
                    displays[input.id] = display;
                }
            }
        });
        console.log('Initialized display elements:', Object.keys(displays));
    }

    // Initialize Tone.js context explicitly
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    Tone.setContext(audioContext);

    // Function to ensure audio context is running
    async function ensureAudioContext() {
        console.log('Ensuring audio context is running...');
        if (audioContext.state !== 'running') {
            console.log('Attempting to resume audio context...');
            try {
                await audioContext.resume();
                await Tone.start();
                console.log('Audio context resumed successfully:', audioContext.state);
            } catch (error) {
                console.error('Failed to resume audio context:', error);
                throw error;
            }
        } else {
            console.log('Audio context already running');
        }
    }

    // --- Main Audio Setup Function ---
    async function setupAudio() {
        if (audioStarted) {
            console.log('Audio already started');
            return;
        }

        try {
            await ensureAudioContext();
            // Rest of setupAudio function remains the same...

            // Initialize displays map
            initializeDisplays();

            // Initialize envelope visualizations
            const filterEnvCanvas = document.getElementById('filter-env-canvas');
            const ampEnvCanvas = document.getElementById('amp-env-canvas');
            if (filterEnvCanvas && ampEnvCanvas) {
                console.log("Initializing envelope visualizations...");
                initEnvelopeVisualization('filter', filterEnvCanvas);
                initEnvelopeVisualization('amp', ampEnvCanvas);
            } else {
                console.warn("Could not find one or both envelope canvases.");
            }

            // === Create Audio Nodes ===
            console.log('Creating audio nodes...');
            
            // Create master volume
            masterVolume = new Tone.Gain(parseFloat(masterVolumeSlider.value)).toDestination();
            console.log('Master volume created and connected to destination');

            // Create envelopes with better release settings
            filterEnv = new Tone.Envelope({
                attack: parseFloat(filterAttackSlider.value),
                decay: parseFloat(filterDecaySlider.value),
                sustain: parseFloat(filterSustainSlider.value),
                release: parseFloat(filterReleaseSlider.value),
                attackCurve: 'exponential',
                releaseCurve: 'exponential'
            });
            console.log('Filter envelope created');

            ampEnv = new Tone.AmplitudeEnvelope({
                attack: parseFloat(ampAttackSlider.value),
                decay: parseFloat(ampDecaySlider.value),
                sustain: parseFloat(ampSustainSlider.value),
                release: parseFloat(ampReleaseSlider.value),
                attackCurve: 'exponential',
                releaseCurve: 'exponential'
            }).connect(masterVolume);
            console.log('Amp envelope created and connected to master volume');

            // Create and connect filter chain
            const initialCutoffFreq = midiToFreq(parseFloat(filterCutoffSlider.value));
            const initialQ = parseFloat(filterQSlider.value);
            
            filterLp = new Tone.Filter({
                frequency: initialCutoffFreq,
                type: 'lowpass',
                rolloff: -12,
                Q: initialQ
            });
            
            filterHp = new Tone.Filter({
                frequency: initialCutoffFreq,
                type: 'highpass',
                rolloff: -12,
                Q: initialQ
            });
            
            filterSweepXFade = new Tone.CrossFade(parseFloat(filterSweepSlider.value));
            
            // Connect filters to crossfade, then to amp envelope
            filterLp.connect(filterSweepXFade.a);
            filterHp.connect(filterSweepXFade.b);
            filterSweepXFade.connect(ampEnv);

            // Set up filter envelope modulation
            const filterEnvModScale = 6000;
            filterEnvMod = new Tone.Scale(0, filterEnvModScale * parseFloat(filterEnvAmtSlider.value));
            filterEnv.connect(filterEnvMod);
            filterEnvMod.connect(filterLp.detune);
            filterEnvMod.connect(filterHp.detune);

            console.log('Filter chain created and connected');

            // Create oscillators with explicit phase
            vco1 = new Tone.Oscillator({
                 frequency: 440,
                 detune: parseFloat(vco1DetuneSlider.value),
                type: vco1WaveSelect.value === 'pulse' ? 'square' : vco1WaveSelect.value,
                phase: 0
             });

            vco2 = new Tone.Oscillator({
                frequency: 440,
                detune: parseFloat(vco2DetuneSlider.value),
                type: vco2WaveSelect.value === 'pulse' ? 'square' : vco2WaveSelect.value,
                phase: 0
            });

            // Create oscillator gains with explicit values
            vco1Gain = new Tone.Gain(parseFloat(mixVco1Slider.value));
            vco2Gain = new Tone.Gain(parseFloat(mixVco2Slider.value));

            // Connect oscillators through the signal chain with explicit logging
            console.log('Connecting oscillators to gains...');
            vco1.connect(vco1Gain);
            vco2.connect(vco2Gain);

            console.log('Connecting gains to filters...');
            vco1Gain.connect(filterLp);
            vco2Gain.connect(filterLp);
            vco1Gain.connect(filterHp);
            vco2Gain.connect(filterHp);
            console.log('Oscillators created and connected to filter chain');

            // Create and setup LFO
            lfo = new Tone.LFO({
                frequency: parseFloat(lfoRateSlider.value),
                type: lfoWaveSelect.value,
                min: -1,
                max: 1
            });

            // Setup LFO modulation routing
            lfoFilterModGain = new Tone.Scale(
                -3000 * parseFloat(filterLfoAmtSlider.value),
                3000 * parseFloat(filterLfoAmtSlider.value)
            );

            lfoVibratoGain = new Tone.Scale(
                -parseFloat(lfoVibratoDepthSlider.value),
                 parseFloat(lfoVibratoDepthSlider.value)
            );

            // Connect LFO modulation
            lfo.connect(lfoFilterModGain);
            lfo.connect(lfoVibratoGain);
            lfoFilterModGain.connect(filterLp.detune);
            lfoFilterModGain.connect(filterHp.detune);
            lfoVibratoGain.connect(vco1.detune);
            lfoVibratoGain.connect(vco2.detune);
            console.log('LFO and modulation routing created and connected');

            // Start all components with explicit checks
            console.log('Starting audio components...');
            try {
                console.log('Starting LFO...');
                lfo.start();
                
                console.log('Starting VCO1...');
            vco1.start();
                vco1.started = true;
                
                console.log('Starting VCO2...');
            vco2.start();
                vco2.started = true;
                
                console.log('All oscillators started successfully');
            } catch (err) {
                console.error('Error starting oscillators:', err);
            }
            
            // Remove test tone which causes popping
            /*
            // Add a simple test tone to verify audio output
            console.log('Creating test tone...');
            const testOsc = new Tone.Oscillator({
                frequency: 440,
                type: 'sine',
                volume: -20
            }).toDestination();
            
            testOsc.start();
            console.log('Test tone started - you should hear a 440Hz sine wave');
            
            // Automatically stop test tone after 1 second
            setTimeout(() => {
                testOsc.stop();
                testOsc.dispose();
                console.log('Test tone stopped');
            }, 1000);
            */

            // Set flag AFTER everything is initialized
            audioStarted = true;
            startButton.disabled = true;
            startButton.textContent = 'Audio Running';

            // Connect UI controls
            connectUI();
            updateAllDisplays();

            // Setup MIDI
            console.log('Audio setup completed successfully');

        } catch (error) {
            console.error('Error during audio setup:', error);
            audioStarted = false;
            startButton.disabled = false;
            startButton.textContent = 'Start Audio Context';
            throw error; // Re-throw to handle in calling function
        }
    }

    // --- UI Control Logic ---
    function connectUI() {
        // Helper to connect slider/select and update display
        function setupControl(element, parameterUpdater) {
            const displayKey = element.id;
            const isSlider = element.type === 'range';

            element.addEventListener('input', (e) => {
                const value = e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value;
                 if(audioStarted) { // Only update Tone nodes if audio is running
                    parameterUpdater(value, e.target);
                 }
                 updateDisplay(displayKey, value, e.target);
            });

            // Add double-click listener for sliders to reset to default
            if (isSlider) {
                element.addEventListener('dblclick', (e) => {
                    const defaultValue = e.target.defaultValue;
                    console.log(`Resetting ${displayKey} to default: ${defaultValue}`);
                    e.target.value = defaultValue; // Reset slider position
                    // Manually trigger the input event to update audio param and display
                    e.target.dispatchEvent(new Event('input', { bubbles:true }));
                });
            }

             // Set initial parameter value if audio already started (e.g., refresh)
             if(audioStarted) {
                 const initialValue = element.type === 'range' ? parseFloat(element.value) : element.value;
                 parameterUpdater(initialValue, element);
             }
        }

        // Global Controls
        setupControl(masterVolumeSlider, (v) => masterVolume.gain.rampTo(v, 0.02));
        setupControl(glideSlider, (v) => {
            if (vco1) vco1.portamento = v;
            if (vco2) vco2.portamento = v;
        });

        // VCO 1
        setupControl(vco1WaveSelect, (v) => {
            if(vco1) {
                // Map 'pulse' UI option to 'square' wave type for Tone.Oscillator
                const newType = (v === 'pulse') ? 'square' : v;
                vco1.type = newType;
                // vco1.width.value = (v === 'pulse') ? 0.5 : 0; // PWM TEMPORARILY DISABLED
            }
        });
        setupControl(vco1DetuneSlider, (v) => { if(vco1) vco1.detune.rampTo(v, 0.02); }); // Vibrato LFO is additive
        // setupControl(vco1PwmDepthSlider, (v) => { if(lfoVco1PwmGain) lfoVco1PwmGain.max = v * 0.5; }); // PWM TEMPORARILY DISABLED
        // setupControl(vco1PwmDepthSlider, (v) => { if(lfoVco1PwmGain) lfoVco1PwmGain.max = v; }); // PWM TEMPORARILY DISABLED

        // VCO 2
        setupControl(vco2WaveSelect, (v) => {
            if(vco2) {
                // Map 'pulse' UI option to 'square' wave type for Tone.Oscillator
                const newType = (v === 'pulse') ? 'square' : v;
                vco2.type = newType;
                // vco2.width.value = (v === 'pulse') ? 0.5 : 0; // PWM TEMPORARILY DISABLED
            }
        } );
        setupControl(vco2DetuneSlider, (v) => { if(vco2) vco2.detune.rampTo(v, 0.02); }); // Vibrato LFO is additive
        // setupControl(vco2PwmDepthSlider, (v) => { if(lfoVco2PwmGain) lfoVco2PwmGain.max = v * 0.5; }); // PWM TEMPORARILY DISABLED
        // setupControl(vco2PwmDepthSlider, (v) => { if(lfoVco2PwmGain) lfoVco2PwmGain.max = v; }); // PWM TEMPORARILY DISABLED

        // Mixer
        setupControl(mixVco1Slider, (v) => { if(vco1Gain) vco1Gain.gain.rampTo(v, 0.02); });
        setupControl(mixVco2Slider, (v) => { if(vco2Gain) vco2Gain.gain.rampTo(v, 0.02); });

        // Filter
        setupControl(filterCutoffSlider, (v) => {
            if (!filterLp || !filterHp) return;
            const freq = midiToFreq(v);
            filterLp.frequency.rampTo(freq, 0.02);
            filterHp.frequency.rampTo(freq, 0.02);
        });
        setupControl(filterQSlider, (v) => {
             if (!filterLp || !filterHp) return;
            filterLp.Q.rampTo(v, 0.02);
            filterHp.Q.rampTo(v, 0.02);
        });
        setupControl(filterSweepSlider, (v) => { if(filterSweepXFade) filterSweepXFade.fade.rampTo(v, 0.02); });
        setupControl(filterEnvAmtSlider, (v) => { if(filterEnvMod) filterEnvMod.max = 6000 * v; }); // Adjust max scale based on knob
        setupControl(filterLfoAmtSlider, (v) => {
             if (!lfoFilterModGain) return;
             const maxModHz = 3000; // Sync with initial value
             lfoFilterModGain.min = -maxModHz * v;
             lfoFilterModGain.max = maxModHz * v;
        });


        // Filter Env
        setupControl(filterAttackSlider, (v) => { if(filterEnv) filterEnv.attack = v; });
        setupControl(filterDecaySlider, (v) => { if(filterEnv) filterEnv.decay = v; });
        setupControl(filterSustainSlider, (v) => { if(filterEnv) filterEnv.sustain = v; });
        setupControl(filterReleaseSlider, (v) => { if(filterEnv) filterEnv.release = v; });

        // Amp Env
        setupControl(ampAttackSlider, (v) => { if(ampEnv) ampEnv.attack = v; });
        setupControl(ampDecaySlider, (v) => { if(ampEnv) ampEnv.decay = v; });
        setupControl(ampSustainSlider, (v) => { if(ampEnv) ampEnv.sustain = v; });
        setupControl(ampReleaseSlider, (v) => { if(ampEnv) ampEnv.release = v; });

        // LFO
        setupControl(lfoWaveSelect, (v) => { if(lfo) lfo.type = v; });
        setupControl(lfoRateSlider, (v) => { if(lfo) lfo.frequency.rampTo(v, 0.02); });
        setupControl(lfoVibratoDepthSlider, (v) => {
            if (!lfoVibratoGain) return;
            lfoVibratoGain.min = -v;
            lfoVibratoGain.max = v;
        });

    }

    // --- Update Display Values ---
     function midiToFreq(midiVal) {
        // Use Tone.js built-in conversion for accuracy
        return Tone.Frequency(midiVal, "midi").toFrequency();
        
        // Legacy implementation as fallback
        /*
        const minLog = Math.log(20);
        const maxLog = Math.log(18000);
        const scale = (maxLog - minLog) / (127 - 1);
        return Math.exp(minLog + scale * (midiVal - 1));
        */
    }

    function updateDisplay(key, value, element) {
        if (!displays[key]) return;
         let displayValue = parseFloat(value).toFixed(2); // Default formatting

         // Custom formatting based on control type
         if (key === 'vco1-detune' || key === 'vco2-detune' || key === 'lfo-vibrato-depth') {
             displayValue = parseInt(value);
         } else if (key === 'filter-cutoff') {
              displayValue = midiToFreq(value).toFixed(0) + " Hz";
         } else if (key === 'filter-sweep') {
              if (value < 0.1) displayValue = 'LP';
              else if (value > 0.9) displayValue = 'HP';
              else if (Math.abs(value - 0.5) < 0.1) displayValue = 'Notch';
              else displayValue = `~${(value * 100).toFixed(0)}%`; // Show % between poles
         } else if (key === 'filter-q' || key === 'lfo-rate') {
              displayValue = parseFloat(value).toFixed(1);
         } else if (key.includes('attack') || key.includes('decay') || key.includes('release') || key === 'glide') {
              displayValue = parseFloat(value).toFixed(3) + " s";
         } else if (key.includes('sustain') || key.includes('mix') || key.includes('amt') || key.includes('depth') || key === 'master-volume') {
              displayValue = parseFloat(value).toFixed(2);
         }

        displays[key].textContent = displayValue;
    }

     function updateAllDisplays() {
         // Use the references directly instead of searching by key
         Object.keys(displays).forEach(id => {
             const inputElement = document.getElementById(id);
             if (inputElement && displays[id]) {
                 updateDisplay(id, inputElement.value, inputElement);
             }
         });
         
         // Redraw envelope visualizations
         const filterEnvCanvas = document.getElementById('filter-env-canvas');
         const ampEnvCanvas = document.getElementById('amp-env-canvas');
         if (filterEnvCanvas && ampEnvCanvas) {
             initEnvelopeVisualization('filter', filterEnvCanvas);
             initEnvelopeVisualization('amp', ampEnvCanvas);
         }
     }


    // --- MIDI Handling ---
    async function setupMIDI() {
        console.log('Setting up MIDI...');
        if (!navigator.requestMIDIAccess) {
            console.warn("WebMIDI is not supported in this browser.");
            midiInputSelector.innerHTML = '<option>Not Supported</option>';
            midiInputSelector.disabled = true;
            return;
        }
        
        try {
            // Use cached promise if available to prevent multiple permission requests
            if (!cachedMidiPromise) {
                console.log('Requesting MIDI access for the first time...');
                // Request MIDI access with minimal permissions, explicitly setting sysex to false
                const options = { sysex: false };
                cachedMidiPromise = navigator.requestMIDIAccess(options);
            } else {
                console.log('Reusing existing MIDI access permission');
            }
            
            // Await the shared promise
            midiAccess = await cachedMidiPromise;
            console.log('MIDI access granted!');
            
            // Setup the input selector
            populateMIDIInputs();
            
            // Add change event listener to the dropdown only if it hasn't been added before
            if (!midiInputSelector._hasChangeListener) {
                midiInputSelector.addEventListener('change', handleMIDIInputChange);
                midiInputSelector._hasChangeListener = true;
            }
            
            // Setup statechange handler for device connect/disconnect
            // Use a simpler approach to avoid permission warnings
            const checkMIDIDevices = () => {
                populateMIDIInputs();
                if (!currentMidiInputId && midiInputSelector.options.length > 1) {
                    // Auto select first device if none selected
                    const firstDeviceId = midiInputSelector.options[1].value;
                    midiInputSelector.value = firstDeviceId;
                    handleMIDIInputChange({ target: { value: firstDeviceId } });
                }
            };
            
            // Use polling instead of statechange which might require additional permissions
            // Only set up polling if it hasn't been set up before
            if (!window._midiCheckInterval) {
                window._midiCheckInterval = setInterval(checkMIDIDevices, 2000);
            }
            
            // Auto-select the first device if available
            const inputs = Array.from(midiAccess.inputs.values());
            if (inputs.length > 0 && !currentMidiInputId) {
                console.log('Auto-selecting first MIDI device:', inputs[0].name);
                midiInputSelector.value = inputs[0].id;
                handleMIDIInputChange({ target: { value: inputs[0].id } });
                activateMidiLight();
            } else {
                console.log('No MIDI inputs available or already selected');
            }
        } catch (error) {
            console.error('Failed to get MIDI access:', error);
            midiInputSelector.innerHTML = '<option>MIDI Access Failed</option>';
            midiInputSelector.disabled = true;
            // Clear the promise on error so we can try again
            cachedMidiPromise = null;
        }
    }
    
    // Function to populate MIDI input dropdown
    function populateMIDIInputs() {
        if (!midiAccess) return;
        
        // Get all inputs as an array for easier handling
        const inputs = Array.from(midiAccess.inputs.values());
        console.log(`Found ${inputs.length} MIDI inputs:`, inputs.map(i => i.name));
        
        // Update the dropdown
        if (inputs.length === 0) {
            midiInputSelector.innerHTML = '<option value="">No MIDI devices found</option>';
            midiInputSelector.disabled = true;
            return;
        }
        
        // Store current selection to restore it if possible
        const currentSelection = midiInputSelector.value;
        
        // Populate the dropdown with available devices
        midiInputSelector.innerHTML = '<option value="">-- Select MIDI Device --</option>';
        inputs.forEach(input => {
            const option = document.createElement('option');
            option.value = input.id;
            option.text = input.name;
            // Select if this is the current device
            if (input.id === currentMidiInputId) {
                option.selected = true;
            }
            midiInputSelector.appendChild(option);
        });
        midiInputSelector.disabled = false;
        
        // Try to restore previous selection if the device is still available
        if (currentSelection && Array.from(midiAccess.inputs.keys()).includes(currentSelection)) {
            midiInputSelector.value = currentSelection;
        }
        
        // Log the current device ID and dropdown value
        console.log('Current MIDI input ID:', currentMidiInputId);
        console.log('MIDI dropdown value:', midiInputSelector.value);
    }
    
    // Handle MIDI input selection change
    function handleMIDIInputChange(event) {
        const selectedInputId = event.target.value;
        console.log('MIDI input selection changed to:', selectedInputId);
        
        // Remove listener from current input if any
        detachCurrentMIDIListener();
        
        // Set up new input
        if (selectedInputId && midiAccess) {
            const selectedInput = midiAccess.inputs.get(selectedInputId);
            if (selectedInput) {
                console.log(`Attaching MIDI listener to: ${selectedInput.name}`);
                
                // Use simple function to just handle basic MIDI note messages
                selectedInput.onmidimessage = function(event) {
                    // Only log the message type, not the full data to avoid permission concerns
                    const [status] = event.data;
                    const command = status >> 4;
                    const channel = status & 0xf;
                    
                    console.log(`MIDI message received: command=${command}, channel=${channel}`);
                    
                    // Process the message normally
                    handleMIDIMessage(event);
                };
                
                currentMidiInputId = selectedInputId;
                activateMidiLight(); // Flash the light to show connection
                
                console.log(`MIDI keyboard "${selectedInput.name}" connected`);
            } else {
                console.warn(`Selected MIDI input ${selectedInputId} not found`);
            }
        } else {
            console.log('No MIDI input selected');
        }
    }
    
    // Remove message handler from current input
    function detachCurrentMIDIListener() {
        if (currentMidiInputId && midiAccess) {
            const currentInput = midiAccess.inputs.get(currentMidiInputId);
            if (currentInput) {
                console.log(`Detaching MIDI listener from: ${currentInput.name}`);
                currentInput.onmidimessage = null;
            }
        }
        currentMidiInputId = null;
    }

    // Function to activate the MIDI light with ADSR envelope
    function activateMidiLight(isNoteOn = true) {
        // Get a fresh reference to the light element
        const light = document.getElementById('midi-activity-light');
        if (!light) {
            console.warn('MIDI activity light element not found');
            return;
        }
        
        // Clear any existing animation or timeout
        if (midiLightTimeout) {
            clearTimeout(midiLightTimeout);
            midiLightTimeout = null;
        }
        
        // If animation is running, cancel it
        if (light.midiAnimation) {
            light.midiAnimation.cancel();
            light.midiAnimation = null;
        }
        
        // For note-on events, follow the ADSR envelope
        if (isNoteOn && ampEnv) {
            // Make sure the light is visible and has active class
            light.classList.add('active');
            light.style.opacity = '0';
            light.style.display = 'inline-block';
            
            // Get current ADSR values from the amp envelope
            const attack = parseFloat(ampAttackSlider.value);
            const decay = parseFloat(ampDecaySlider.value);
            const sustain = parseFloat(ampSustainSlider.value);
            const totalAttackDecayTime = attack + decay;
            
            // Create animation that follows the attack and decay phases
            try {
                const keyframes = [
                    { opacity: 0, boxShadow: '0 0 5px var(--highlight-color)' },
                    { opacity: 1, boxShadow: '0 0 15px var(--highlight-color), 0 0 5px var(--highlight-color)', offset: attack / totalAttackDecayTime },
                    { opacity: sustain, boxShadow: `0 0 ${10 * sustain}px var(--highlight-color), 0 0 ${5 * sustain}px var(--highlight-color)` }
                ];
                
                const timing = {
                    duration: totalAttackDecayTime * 1000, // Convert to milliseconds
                    easing: 'ease-out',
                    fill: 'forwards'
                };
                
                // Start the animation and store reference to it
                light.midiAnimation = light.animate(keyframes, timing);
                
                console.log(`MIDI light following ADSR: A=${attack}s, D=${decay}s, S=${sustain}`);
            } catch (e) {
                // Fallback if Web Animation API is not supported
                console.warn('Web Animation API not supported, using fallback for MIDI light', e);
                light.style.opacity = sustain.toString();
            }
        } else {
            // For note-off or when amplitude envelope isn't available
            if (ampEnv) {
                // Get the release time directly from the amp envelope
                const release = parseFloat(ampReleaseSlider.value);
                const currentOpacity = parseFloat(getComputedStyle(light).opacity || '1');
                
                // Avoid extremely short release animations
                const minReleaseDuration = 0.05; // 50ms minimum
                const effectiveRelease = Math.max(release, minReleaseDuration);

                // Make sure the light is still visible during release
                light.style.display = 'inline-block';
                
                try {
                    // Create animation that follows the release phase
                    const keyframes = [
                        { 
                            opacity: currentOpacity,
                            boxShadow: window.getComputedStyle(light).boxShadow 
                        },
                        { 
                            opacity: 0,
                            boxShadow: '0 0 0 var(--highlight-color)' 
                        }
                    ];
                    
                    const timing = {
                        duration: effectiveRelease * 1000, // Convert to milliseconds
                        easing: 'cubic-bezier(0.1, 0, 0.3, 1)', // More natural release curve
                        fill: 'forwards'
                    };
                    
                    // Start fade-out animation and store reference
                    light.midiAnimation = light.animate(keyframes, timing);
                    
                    // Remove active class after release time
                    midiLightTimeout = setTimeout(() => {
                        light.classList.remove('active');
                        console.log('MIDI light release complete');
                    }, effectiveRelease * 1000);
                    
                    console.log(`MIDI light release: R=${effectiveRelease}s, starting opacity=${currentOpacity}`);
                } catch (e) {
                    // Simple fallback
                    light.style.opacity = '0';
                    light.classList.remove('active');
                    console.warn('Animation API not supported, using fallback for MIDI light fade', e);
                }
            } else {
                // Simple fallback if no envelope
                light.style.opacity = '0';
                light.classList.remove('active');
            }
        }
    }

    async function handleMIDIMessage(event) {
        try {
            // Log the raw MIDI message for debugging
            console.log('Raw MIDI message received:', event.data);
            
            // Ensure audio context is running
            if (audioContext.state !== 'running' || !audioStarted) {
                console.log('Audio not ready, attempting to initialize...');
                await ensureAudioContext();
                if (!audioStarted) {
                    console.log('Starting audio system from MIDI trigger');
                    await startAudio();
                }
            }

            // Extract MIDI message components
            const [status, data1, data2] = event.data;
            const command = status >> 4;
            const channel = status & 0xf;
            
            console.log(`MIDI message decoded: command=${command}, channel=${channel}, data1=${data1}, data2=${data2}`);

            // Process MIDI message
            if (audioStarted && audioContext.state === 'running') {
                // Handle different MIDI message types
                if (command === 9 && data2 > 0) {
                    // Note On - activate MIDI light with note-on
                    activateMidiLight(true); // Note on
                    console.log(`MIDI Note On: note=${data1}, velocity=${data2/127}`);
                    handleNoteOn(data1, data2 / 127);
                } else if (command === 8 || (command === 9 && data2 === 0)) {
                    // Note Off - handleNoteOff will manage the light release
                    console.log(`MIDI Note Off: note=${data1}`);
                    handleNoteOff(data1);
                } else if (command === 11) {
                    // Control Change - just flash MIDI light briefly
                    const lightFlash = document.getElementById('midi-activity-light');
                    if (lightFlash) {
                        lightFlash.classList.add('active');
                        setTimeout(() => lightFlash.classList.remove('active'), 100);
                    }
                    console.log(`MIDI CC: controller=${data1}, value=${data2}`);
                    handleCC(data1, data2);
                } else if (command === 14) {
                    // Pitch Bend - just flash MIDI light briefly
                    const lightFlash = document.getElementById('midi-activity-light');
                    if (lightFlash) {
                        lightFlash.classList.add('active');
                        setTimeout(() => lightFlash.classList.remove('active'), 100);
                    }
                    const pitchValue = ((data2 << 7) + data1 - 8192) / 8192;
                    console.log(`MIDI Pitch Bend: value=${pitchValue.toFixed(3)}`);
                    handlePitchBend(pitchValue);
                } else {
                    console.log(`Unhandled MIDI command: ${command}`);
                }
            } else {
                console.warn('Audio system not ready, MIDI message ignored. Audio state:', audioContext.state, 'audioStarted:', audioStarted);
            }
        } catch (error) {
            console.error('Error processing MIDI message:', error);
        }
    }

    function handleNoteOn(note, velocity, time = audioContext.currentTime) {
        if (!vco1 || !vco2 || !ampEnv || !filterEnv) {
            console.error('Cannot play note - audio components not initialized');
            return;
        }
        
        try {
            // Convert MIDI note to frequency directly
            const freq = midiToFreq(note);
            
            // Only trigger envelope if the sound isn't already playing
            if (!activeNotes.has(note)) {
                // Note on - set oscillator frequencies with glide time
                const glideTime = parseFloat(glideSlider.value);
                
                // If it's the first note, set immediately, otherwise use glide
                if (currentNote === null) {
                    vco1.frequency.setValueAtTime(freq, time);
                    vco2.frequency.setValueAtTime(freq, time);
                } else {
                    // Use exponential ramp for more natural glide between notes
                    vco1.frequency.exponentialRampToValueAtTime(freq, time + glideTime);
                    vco2.frequency.exponentialRampToValueAtTime(freq, time + glideTime);
                }
                
                // Trigger envelope if note is the first one played
                if (activeNotes.size === 0) {
                    // Trigger envelopes with velocity scaling
                    filterEnv.triggerAttack(time, velocity);
                    ampEnv.triggerAttack(time, velocity);
                }
                
                // Store active note in our set & current note for frequency reference
                activeNotes.add(note);
                currentNote = note;
                
                console.log(`Note On: ${note} (${freq.toFixed(1)}Hz) at velocity ${velocity}`);
            } else {
                console.log(`Note ${note} already active, ignoring`);
            }
        } catch (error) {
            console.error(`Error in handleNoteOn(${note}, ${velocity}):`, error);
        }
    }

    function handleNoteOff(note, time = audioContext.currentTime) {
        try {
            // Only handle if the note is actually active
            if (activeNotes.has(note)) {
                // Remove the note from our active set
                activeNotes.delete(note);
                
                // If no more notes are active, trigger release
                if (activeNotes.size === 0) {
                    // Activate MIDI light release only when all notes are off
                    activateMidiLight(false);
                    
                    filterEnv.triggerRelease(time);
                    ampEnv.triggerRelease(time);
                    currentNote = null;
                    console.log(`All notes released`);
                } else {
                    // If other notes are still held, get the highest remaining one
                    currentNote = Math.max(...Array.from(activeNotes));
                    const freq = midiToFreq(currentNote);
                    
                    // Set the frequency to the highest held note
                    const glideTime = parseFloat(glideSlider.value);
                    vco1.frequency.exponentialRampToValueAtTime(freq, time + glideTime);
                    vco2.frequency.exponentialRampToValueAtTime(freq, time + glideTime);
                    
                    console.log(`Released note ${note}, highest remaining: ${currentNote} (${freq.toFixed(1)}Hz)`);
                }
            } else {
                console.log(`Note ${note} not active, ignoring release`);
            }
        } catch (error) {
            console.error(`Error in handleNoteOff(${note}):`, error);
        }
    }

    // Add helper function to update displays after playing notes
    function updateDisplays() {
        // Update any visual elements that should reflect the current state
        // For now, just log the state
        console.log('Updating displays. Current state:', {
            activeNotes: Array.from(activeNotes),
            currentNote
        });
    }

    function handlePitchBend(bendValue) {
        if (!vco1 || !vco2) return;
        
        // Calculate bend amount in cents (-/+ pitchBendRange semitones)
        // pitchBendRange is defined at top of file (default: 2 semitones)
        const bendAmount = (bendValue / 8191) * pitchBendRange * 100;
        
        // Get base detune values from sliders
        const vco1BaseDetune = parseFloat(vco1DetuneSlider.value);
        const vco2BaseDetune = parseFloat(vco2DetuneSlider.value);
        
        // Calculate target detune by adding bend to base detune
        const vco1TargetDetune = vco1BaseDetune + bendAmount;
        const vco2TargetDetune = vco2BaseDetune + bendAmount;
        
        // Apply the detuning with a short ramp time for smooth bending
        const bendRampTime = 0.02; // 20ms for smooth response
        vco1.detune.rampTo(vco1TargetDetune, bendRampTime);
        vco2.detune.rampTo(vco2TargetDetune, bendRampTime);
    }

    function handleCC(ccNumber, ccValue) {
        console.log(`CC Received: CC#${ccNumber}, Value=${ccValue}`);
        
        // Normalize the CC value to 0.0-1.0 range
        const valueNorm = ccValue / 127;
        
        // Map MIDI CC numbers to synth parameters
        switch(ccNumber) {
            case 1: // Mod Wheel -> Vibrato Depth
                if (lfoVibratoDepthSlider) {
                    // Calculate new value based on slider range
                    const newValue = Math.round(valueNorm * (lfoVibratoDepthSlider.max - lfoVibratoDepthSlider.min) + parseFloat(lfoVibratoDepthSlider.min));
                    lfoVibratoDepthSlider.value = newValue;
                    // Dispatch input event to trigger the UI handler
                    lfoVibratoDepthSlider.dispatchEvent(new Event('input', { bubbles: true }));
                }
                break;
                
            case 74: // Filter Cutoff
                if (filterCutoffSlider) {
                    // Map to filter cutoff (usually 20Hz-20kHz mapped to MIDI note values)
                    const newValue = Math.round(valueNorm * (filterCutoffSlider.max - filterCutoffSlider.min) + parseFloat(filterCutoffSlider.min));
                    filterCutoffSlider.value = newValue;
                    filterCutoffSlider.dispatchEvent(new Event('input', { bubbles: true }));
                }
                break;
                
            case 71: // Filter Resonance/Q
                if (filterQSlider) {
                    const newValue = valueNorm * (filterQSlider.max - filterQSlider.min) + parseFloat(filterQSlider.min);
                    filterQSlider.value = newValue;
                    filterQSlider.dispatchEvent(new Event('input', { bubbles: true }));
                }
                break;
                
            case 5: // Glide/Portamento Time
                if (glideSlider) {
                    const newValue = valueNorm * (glideSlider.max - glideSlider.min) + parseFloat(glideSlider.min);
                    glideSlider.value = newValue;
                    glideSlider.dispatchEvent(new Event('input', { bubbles: true }));
                }
                break;
                
            // Add more CC mappings as needed
        }
    }

    // --- Envelope Visualization Functions ---
    function initEnvelopeVisualization(envType, canvas) {
        if (!canvas) {
            console.error(`Cannot initialize ${envType} envelope: canvas is null`);
            return;
        }
        
        console.log(`Initializing ${envType} envelope on canvas:`, canvas);
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            console.error(`Cannot get 2D context for ${envType} envelope canvas`);
            return;
        }
        
        const width = canvas.width;
        const height = canvas.height;
        console.log(`Canvas dimensions: ${width}x${height}`);
        
        // Get envelope parameters
        const attackInput = document.getElementById(`${envType}-attack`);
        const decayInput = document.getElementById(`${envType}-decay`);
        const sustainInput = document.getElementById(`${envType}-sustain`);
        const releaseInput = document.getElementById(`${envType}-release`);
        
        // Get value display elements
        const attackValue = document.getElementById(`${envType}-attack-value`);
        const decayValue = document.getElementById(`${envType}-decay-value`);
        const sustainValue = document.getElementById(`${envType}-sustain-value`);
        const releaseValue = document.getElementById(`${envType}-release-value`);
        
        // Draw initial envelope
        console.log(`Drawing initial ${envType} envelope`);
        drawEnvelope();
        
        // Log the canvas dimensions and parameters
        console.log(`Canvas dimensions: ${width}x${height}`);
        console.log(`${envType} params: A=${attackInput.value}, D=${decayInput.value}, S=${sustainInput.value}, R=${releaseInput.value}`);
        
        // Handle mouse interactions
        let isDragging = false;
        let activePoint = null;
        
        // Remove any existing event listeners first to avoid duplicates
        canvas.removeEventListener('mousedown', handleMouseDown);
        canvas.removeEventListener('mousemove', handleMouseMove);
        canvas.removeEventListener('mouseup', handleMouseUp);
        canvas.removeEventListener('mouseleave', handleMouseLeave);
        
        // Function references for event removal
        function handleMouseUp() { 
            console.log(`${envType} envelope: Mouse up`);
            isDragging = false; 
            activePoint = null; 
        }
        
        function handleMouseLeave() { 
            console.log(`${envType} envelope: Mouse leave`);
            isDragging = false; 
            activePoint = null; 
        }
        
        // Add the event listeners
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mouseleave', handleMouseLeave);
        
        // Touch support - remove any existing handlers first
        canvas.removeEventListener('touchstart', handleTouchStart);
        canvas.removeEventListener('touchmove', handleTouchMove);
        canvas.removeEventListener('touchend', handleTouchEnd);
        
        function handleTouchStart(e) {
            e.preventDefault();
            console.log(`${envType} envelope: Touch start`);
            const touch = e.touches[0];
            handleMouseDown({ clientX: touch.clientX, clientY: touch.clientY });
        }
        
        function handleTouchMove(e) {
            e.preventDefault();
            if (isDragging) {
                console.log(`${envType} envelope: Touch move`);
                const touch = e.touches[0];
                handleMouseMove({ clientX: touch.clientX, clientY: touch.clientY });
            }
        }
        
        function handleTouchEnd(e) {
            e.preventDefault();
            console.log(`${envType} envelope: Touch end`);
            isDragging = false; 
            activePoint = null;
        }
        
        canvas.addEventListener('touchstart', handleTouchStart);
        canvas.addEventListener('touchmove', handleTouchMove);
        canvas.addEventListener('touchend', handleTouchEnd);
        
        function handleMouseDown(e) {
            console.log(`${envType} envelope: Mouse down at client coords ${e.clientX},${e.clientY}`);
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            console.log(`Canvas relative coords: ${x},${y}`);
            
            // Calculate envelope points
            const points = calculateEnvelopePoints();
            console.log('Points for hit testing:', points);
            
            // Check if clicked near a control point - use a larger hit radius for better usability
            const hitRadius = 30; // Increased from 15 to 30 for easier clicking
            
            // Attack point (peak)
            if (Math.abs(x - points.attackX) < hitRadius && Math.abs(y - points.attackY) < hitRadius) {
                console.log('HIT: Attack point');
                isDragging = true;
                activePoint = 'attack';
                return;
            }
            
            // Decay/Sustain point (middle)
            if (Math.abs(x - points.decayX) < hitRadius && Math.abs(y - points.sustainY) < hitRadius) {
                console.log('HIT: Decay/Sustain point');
                isDragging = true;
                activePoint = 'decay-sustain';
                return;
            }
            
            // Release end point (end)
            if (Math.abs(x - points.releaseX) < hitRadius && Math.abs(y - points.releaseY) < hitRadius) {
                console.log('HIT: Release point');
                isDragging = true;
                activePoint = 'release';
                return;
            }
            
            // Sustain end point
            if (Math.abs(x - points.sustainX) < hitRadius && Math.abs(y - points.sustainY) < hitRadius) {
                console.log('HIT: Sustain end point');
                isDragging = true;
                activePoint = 'sustain-end';
                return;
            }
            
            // If no specific point was hit, check if we're within the envelope path
            // and allow dragging the nearest point
            if (y <= height && y >= 0 && x >= 0 && x <= width) {
                // Find the closest control point
                const distToAttack = Math.hypot(x - points.attackX, y - points.attackY);
                const distToDecay = Math.hypot(x - points.decayX, y - points.sustainY);
                const distToSustainEnd = Math.hypot(x - points.sustainX, y - points.sustainY);
                const distToRelease = Math.hypot(x - points.releaseX, y - points.releaseY);
                
                const minDist = Math.min(distToAttack, distToDecay, distToSustainEnd, distToRelease);
                
                if (minDist === distToAttack) {
                    console.log('Closest to Attack point');
                    isDragging = true;
                    activePoint = 'attack';
                } else if (minDist === distToDecay) {
                    console.log('Closest to Decay/Sustain point');
                    isDragging = true;
                    activePoint = 'decay-sustain';
                } else if (minDist === distToSustainEnd) {
                    console.log('Closest to Sustain end point');
                    isDragging = true;
                    activePoint = 'sustain-end';
                } else {
                    console.log('Closest to Release point');
                    isDragging = true;
                    activePoint = 'release';
                }
            }
        }
        
        function handleMouseMove(e) {
            if (!isDragging || !activePoint) return;
            
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            console.log(`${envType} envelope: Mouse move at ${x},${y} - dragging ${activePoint}`);
            
            // Constrain to canvas bounds
            const clampedX = Math.max(0, Math.min(width, x));
            const clampedY = Math.max(0, Math.min(height, y));
            
            // Update parameters based on drag
            const points = calculateEnvelopePoints();
            const startX = points.startX;
            const availableWidth = width * 0.9; // 90% of canvas width
            
            switch (activePoint) {
                case 'attack':
                    // X position maps to attack time with improved scaling
                    const attackPortion = 0.2; // 20% of available width
                    const minWidth = availableWidth * 0.05; // 5% minimum width
                    
                    // Calculate normalized position (0-1) accounting for minimum width
                    const attackNorm = Math.max(0, Math.min(1, (clampedX - startX) / (availableWidth * attackPortion)));
                    const attackMin = parseFloat(attackInput.min);
                    const attackMax = parseFloat(attackInput.max);
                    
                    // Use a more balanced curve for better control of small values
                    // This is a power curve that gives more precision to smaller values
                    const attackVal = attackMin + Math.pow(attackNorm, 2) * (attackMax - attackMin);
                    attackInput.value = Math.max(attackMin, Math.min(attackMax, attackVal));
                    attackValue.textContent = parseFloat(attackInput.value).toFixed(3) + ' s';
                    break;
                    
                case 'decay-sustain':
                    // X position maps to decay time with improved scaling
                    const decayPortion = 0.3; // 30% of available width
                    
                    // Calculate normalized position (0-1) with better bounds
                    const decayNorm = Math.max(0, Math.min(1, (clampedX - points.attackX) / 
                                                         Math.max(availableWidth * 0.05, availableWidth * decayPortion)));
                    const decayMin = parseFloat(decayInput.min);
                    const decayMax = parseFloat(decayInput.max);
                    
                    // Use a more balanced curve for better control
                    const decayVal = decayMin + Math.pow(decayNorm, 2) * (decayMax - decayMin);
                    decayInput.value = Math.max(decayMin, Math.min(decayMax, decayVal));
                    decayValue.textContent = parseFloat(decayInput.value).toFixed(3) + ' s';
                    
                    // Y position maps to sustain level (linear)
                    // Map from canvas coordinates to 0-1 range, accounting for our vertical padding
                    const sustainNorm = 1 - ((clampedY - (height * 0.1)) / (height * 0.8));
                    sustainInput.value = Math.max(0, Math.min(1, sustainNorm)).toFixed(2);
                    sustainValue.textContent = parseFloat(sustainInput.value).toFixed(2);
                    break;
                    
                case 'sustain-end':
                    // Only allow vertical movement to adjust sustain level
                    const sustainNorm2 = 1 - ((clampedY - (height * 0.1)) / (height * 0.8));
                    sustainInput.value = Math.max(0, Math.min(1, sustainNorm2)).toFixed(2);
                    sustainValue.textContent = parseFloat(sustainInput.value).toFixed(2);
                    break;
                    
                case 'release':
                    // X position maps to release time with improved scaling
                    const releasePortion = 0.2; // 20% of available width
                    
                    // Calculate normalized position (0-1) with better bounds
                    const releaseNorm = Math.max(0, Math.min(1, (clampedX - points.sustainX) / 
                                                           Math.max(availableWidth * 0.05, availableWidth * releasePortion)));
                    const releaseMin = parseFloat(releaseInput.min);
                    const releaseMax = parseFloat(releaseInput.max);
                    
                    // Use a more balanced curve for better control
                    const releaseVal = releaseMin + Math.pow(releaseNorm, 2) * (releaseMax - releaseMin);
                    releaseInput.value = Math.max(releaseMin, Math.min(releaseMax, releaseVal));
                    releaseValue.textContent = parseFloat(releaseInput.value).toFixed(3) + ' s';
                    break;
            }
            
            // Redraw envelope
            drawEnvelope();
            
            // Update display values - convert string values to numbers before using toFixed()
            if (activePoint === 'attack') {
                attackValue.textContent = parseFloat(attackInput.value).toFixed(3) + ' s';
            } else if (activePoint === 'decay-sustain') {
                decayValue.textContent = parseFloat(decayInput.value).toFixed(3) + ' s';
                sustainValue.textContent = parseFloat(sustainInput.value).toFixed(2);
            } else if (activePoint === 'release') {
                releaseValue.textContent = parseFloat(releaseInput.value).toFixed(3) + ' s';
            }
            
            // Trigger input event to update synth parameters
            if (activePoint === 'attack' || activePoint === 'decay-sustain') {
                attackInput.dispatchEvent(new Event('input'));
                decayInput.dispatchEvent(new Event('input'));
            }
            if (activePoint === 'decay-sustain') {
                sustainInput.dispatchEvent(new Event('input'));
            }
            if (activePoint === 'release') {
                releaseInput.dispatchEvent(new Event('input'));
            }
        }
        
        function calculateEnvelopePoints() {
            const attackTime = parseFloat(attackInput.value);
            const decayTime = parseFloat(decayInput.value);
            const sustainLevel = parseFloat(sustainInput.value);
            const releaseTime = parseFloat(releaseInput.value);
            
            // Map time values to x-coordinates with logarithmic scaling for better visualization
            // This helps with the wider ranges we now support
            const attackMax = parseFloat(attackInput.max);
            const decayMax = parseFloat(decayInput.max);
            const releaseMax = parseFloat(releaseInput.max);
            
            // Apply a better scaling function that works well for both small and large values
            const logScale = (value, max) => {
                // Use a linear-logarithmic hybrid scaling that works better for visualization
                // This ensures small values don't disappear and large values don't dominate
                const linearPortion = 0.3; // 30% linear scaling for small values
                const logPortion = 0.7;    // 70% logarithmic scaling for larger values
                
                // Normalize value to 0-1 range
                const normalizedValue = value / max;
                
                // Combine linear and logarithmic scaling
                return (linearPortion * normalizedValue) + 
                       (logPortion * (Math.log(normalizedValue * 9 + 1) / Math.log(10)));
            };
            
            // Calculate x positions with better proportions
            // Start with a small offset from left edge
            const startX = width * 0.05;
            const endX = width * 0.95;
            const availableWidth = endX - startX;
            
            // Allocate width proportionally to make it look good
            const attackPortion = 0.2; // 20% for attack
            const decayPortion = 0.3;  // 30% for decay
            const sustainPortion = 0.3; // 30% for sustain
            const releasePortion = 0.2; // 20% for release
            
            // Calculate actual positions with better scaling and minimum widths
            // Ensure each segment has a minimum width for visibility
            const minSegmentWidth = availableWidth * 0.05; // 5% minimum width for any segment
            
            // Attack segment - ensure it's at least minSegmentWidth wide
            const attackScaled = logScale(attackTime, attackMax);
            const attackWidth = Math.max(minSegmentWidth, availableWidth * attackPortion * attackScaled);
            const attackX = startX + attackWidth;
            
            // Decay segment - ensure it's at least minSegmentWidth wide
            const decayScaled = logScale(decayTime, decayMax);
            const decayWidth = Math.max(minSegmentWidth, availableWidth * decayPortion * decayScaled);
            const decayX = attackX + decayWidth;
            
            // Sustain segment - fixed width based on portion
            const sustainWidth = availableWidth * sustainPortion;
            const sustainX = decayX + sustainWidth;
            
            // Release segment - ensure it's at least minSegmentWidth wide
            const releaseScaled = logScale(releaseTime, releaseMax);
            const releaseWidth = Math.max(minSegmentWidth, availableWidth * releasePortion * releaseScaled);
            const releaseX = sustainX + releaseWidth;
            
            // Calculate y positions (inverted because canvas y=0 is at top)
            const startY = height * 0.9; // Start slightly above bottom
            const peakY = height * 0.1;  // Peak slightly below top
            const attackY = peakY;       // Attack peak
            const sustainY = height * (1 - sustainLevel * 0.8); // Sustain level (scaled)
            const releaseY = startY;     // Release end
            
            return { 
                startX, startY, 
                attackX, attackY, 
                decayX, sustainY, 
                sustainX, 
                releaseX, releaseY 
            };
        }
        
        function drawEnvelope() {
            console.log(`Drawing ${envType} envelope`);
            
            // Clear canvas
            ctx.clearRect(0, 0, width, height);
            
            // Get envelope parameters
            const points = calculateEnvelopePoints();
            console.log('Envelope points:', points);
            
            // Set default styles with Fallout green
            ctx.strokeStyle = '#6b8f3f'; // Fallout terminal green
            ctx.lineWidth = 2;
            ctx.fillStyle = 'rgba(107, 143, 63, 0.2)'; // Fallout green with transparency
            
            // Draw envelope path - proper ADSR mountain shape
            ctx.beginPath();
            
            // Start at bottom left with a small offset
            ctx.moveTo(points.startX, points.startY);
            
            // Attack segment - rises to peak
            ctx.lineTo(points.attackX, points.attackY);
            
            // Decay segment - falls to sustain level
            ctx.lineTo(points.decayX, points.sustainY);
            
            // Sustain segment - horizontal line
            ctx.lineTo(points.sustainX, points.sustainY);
            
            // Release segment - falls back to bottom
            ctx.lineTo(points.releaseX, points.releaseY);
            
            // Stroke the path
            ctx.stroke();
            
            // Fill the area under the curve
            ctx.lineTo(points.startX, points.startY); // Back to start point
            ctx.closePath();
            ctx.fill();
            
            // Draw control points
            drawControlPoint(points.attackX, points.attackY); // Attack peak
            drawControlPoint(points.decayX, points.sustainY); // Decay/Sustain
            drawControlPoint(points.sustainX, points.sustainY); // End of sustain
            drawControlPoint(points.releaseX, points.releaseY); // Release end
            
            // Draw labels for ADSR
            ctx.font = '10px sans-serif';
            ctx.fillStyle = '#9ead9c'; // Muted green-gray text
            ctx.textAlign = 'center';
            
            // Label each segment
            ctx.fillText('A', (points.startX + points.attackX) / 2, height - 10);
            ctx.fillText('D', (points.attackX + points.decayX) / 2, height - 10);
            ctx.fillText('S', (points.decayX + points.sustainX) / 2, height - 10);
            ctx.fillText('R', (points.sustainX + points.releaseX) / 2, height - 10);
        }
        
        function drawControlPoint(x, y) {
            // Draw a larger, more visible control point
            ctx.beginPath();
            ctx.arc(x, y, 8, 0, Math.PI * 2); // Larger radius (was 6)
            ctx.fillStyle = '#8fb33b'; // Bright Fallout green
            ctx.fill();
            ctx.strokeStyle = '#3a4a30'; // Darker green border
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Add a highlight ring for better visibility
            ctx.beginPath();
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(107, 143, 63, 0.3)'; // Fallout green with transparency
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
    
    // --- Initialization ---
    // Function to start audio context and ensure everything is initialized
    async function startAudio() {
        if (audioStarted) {
            console.log('Audio already started');
            return;
        }
        
        try {
            console.log('Starting audio context...');
            // Create and resume the audio context explicitly
            await Tone.context.resume();
            console.log('Audio context state:', Tone.context.state);
            
            // Only proceed if the context is running
            if (Tone.context.state !== 'running') {
                console.warn('Audio context not running, waiting for user gesture');
                return;
            }
            
            await setupAudio();  // Setup all audio components
            
            // Make sure oscillators are started
            if (vco1 && !vco1.started) {
                console.log('Starting oscillators...');
                vco1.start();
                vco1.started = true;
            }
            if (vco2 && !vco2.started) {
                vco2.start();
                vco2.started = true;
            }
            
            // Don't initialize MIDI here anymore as it's already initialized at startup
            // This prevents the duplicate permission popup
            console.log('Using existing MIDI setup');
            
            console.log('Audio context started successfully');
            audioStarted = true;
        } catch (error) {
            console.error('Error during audio initialization:', error);
            // Reset state on error
            audioStarted = false;
            startButton.disabled = false;
            startButton.textContent = 'Start Audio';
        }
    }
    
    // Update the start button to be visible and handle click properly
    startButton.textContent = 'Start Audio';
    startButton.style.fontSize = '1em';
    startButton.style.padding = '10px 20px';
    startButton.style.backgroundColor = '#6b8f3f'; // Fallout terminal green
    startButton.style.color = '#f0f3e6'; // Off-white text
    startButton.style.border = 'none';
    startButton.style.borderRadius = '4px';
    startButton.style.cursor = 'pointer';
    startButton.style.textShadow = '0 0 5px rgba(107, 143, 63, 0.5)'; // Green glow around text
    startButton.style.boxShadow = '0 0 8px rgba(107, 143, 63, 0.3)'; // Subtle button glow
    
    // Handle click on start button
    startButton.addEventListener('click', async () => {
        startButton.textContent = 'Starting...';
        startButton.disabled = true;
        
        try {
            await ensureAudioContext();
            
            if (audioContext.state === 'running') {
                await startAudio();
                startButton.textContent = 'Audio Running';
                startButton.disabled = true;
                console.log('Audio system fully initialized');
            } else {
                throw new Error('Failed to start audio context');
            }
        } catch (error) {
            console.error('Failed to start audio:', error);
            startButton.textContent = 'Start Audio';
            startButton.disabled = false;
            audioStarted = false;
        }
    });
    
    // Initialize displays on page load
    initializeDisplays();
    
    // Initial display update for non-audio-dependent controls
    updateAllDisplays();
    
    // Initialize MIDI at startup to populate the dropdown
    setupMIDI().then(() => {
        // Enable the MIDI selector only after setup is complete
        midiInputSelector.disabled = false;
        console.log('MIDI system initialized');
    }).catch(error => {
        console.error('Failed to initialize MIDI:', error);
    });
    
    // ===== Bass Guitar Module =====
    
    // Define bass string starting notes in MIDI note numbers (E1, A1, D2, G2)
    const bassStringNotes = [28, 33, 38, 43];
    
    // Map to store active notes
    const activeNoteDots = new Map();
    const activeStringElements = new Map();
    
    // Initialize fretless bass
    function initializeFretlessBass() {
        const stringElements = document.querySelectorAll('.bass-string');
        
        stringElements.forEach((stringEl) => {
            const stringIndex = parseInt(stringEl.dataset.string, 10);
            const baseNote = bassStringNotes[stringIndex];
            
            // Add mouse and touch event listeners for fretless string playing
            stringEl.addEventListener('mousedown', (e) => {
                // Use a more accurate position calculation
                const rect = stringEl.getBoundingClientRect();
                
                // The actual playable area starts from the nut width
                const nutWidth = 30; // Width of the nut in pixels
                
                // Calculate relative position within the playable area (adjusted for the right side of the nut)
                // We need to consider both the rect.left offset AND the nut width
                // Note that we're calculating from the rect.left (absolute position) to avoid issues
                const position = (e.clientX - rect.left) / rect.width;
                
                // Clamp position between 0 and 1
                const clampedPosition = Math.max(0, Math.min(1, position));
                
                // Detect if click is actually on the string line (with some tolerance)
                const clickY = e.clientY;
                const stringCenterY = rect.top + (rect.height / 2);
                const stringThickness = stringIndex === 3 ? 2 : 
                                      stringIndex === 2 ? 3 : 
                                      stringIndex === 1 ? 4 : 5;
                const tolerance = Math.max(12, stringThickness + 8); // Larger tolerance for easier clicking
                
                // Only trigger note if click is near the string
                if (Math.abs(clickY - stringCenterY) <= tolerance) {
                    playFretlessNote(stringIndex, clampedPosition);
                }
            });
            
            stringEl.addEventListener('mousemove', (e) => {
                // Only handle slides if the mouse button is pressed
                if (e.buttons === 1) {
                    // Use the same accurate position calculation as mousedown
                    const rect = stringEl.getBoundingClientRect();
                    
                    // Calculate relative position within the string
                    const position = (e.clientX - rect.left) / rect.width;
                    
                    // Clamp position between 0 and 1
                    const clampedPosition = Math.max(0, Math.min(1, position));
                    
                    // Update the position of the active note
                    if (activeStringElements.has(stringIndex)) {
                        updateFretlessNotePosition(stringIndex, clampedPosition);
                    }
                }
            });
            
            stringEl.addEventListener('mouseup', () => {
                releaseFretlessNote(stringIndex);
            });
            
            stringEl.addEventListener('mouseleave', () => {
                releaseFretlessNote(stringIndex);
            });
            
            // Touch support with similar improvements
            stringEl.addEventListener('touchstart', (e) => {
                e.preventDefault();
                const touch = e.touches[0];
                const rect = stringEl.getBoundingClientRect();
                
                // Calculate relative position within the string (same as mouse events)
                const position = (touch.clientX - rect.left) / rect.width;
                
                // Clamp position between 0 and 1
                const clampedPosition = Math.max(0, Math.min(1, position));
                
                // Detect if touch is actually on the string line (with some tolerance)
                const touchY = touch.clientY;
                const stringCenterY = rect.top + (rect.height / 2);
                const stringThickness = stringIndex === 3 ? 2 : 
                                      stringIndex === 2 ? 3 : 
                                      stringIndex === 1 ? 4 : 5;
                const tolerance = Math.max(15, stringThickness + 10); // Larger tolerance for touch
                
                // Only trigger note if touch is near the string
                if (Math.abs(touchY - stringCenterY) <= tolerance) {
                    playFretlessNote(stringIndex, clampedPosition);
                }
            });
            
            stringEl.addEventListener('touchmove', (e) => {
                e.preventDefault();
                const touch = e.touches[0];
                const rect = stringEl.getBoundingClientRect();
                
                // Calculate relative position within the string (same as mouse events)
                const position = (touch.clientX - rect.left) / rect.width;
                
                // Clamp position between 0 and 1
                const clampedPosition = Math.max(0, Math.min(1, position));
                
                // Update the position of the active note
                if (activeStringElements.has(stringIndex)) {
                    updateFretlessNotePosition(stringIndex, clampedPosition);
                }
            });
            
            stringEl.addEventListener('touchend', () => {
                releaseFretlessNote(stringIndex);
            });
        });
        
        console.log('Fretless bass initialized');
    }
    
    // Call the initialization function
    initializeFretlessBass();
    
    // Function to play a fretless note
    function playFretlessNote(stringIndex, position) {
        // Make sure audio is started
        if (!audioStarted) {
            startAudio().then(() => {
                console.log('Audio started from bass note');
                actuallyPlayFretlessNote(stringIndex, position);
            });
        } else {
            actuallyPlayFretlessNote(stringIndex, position);
        }
    }
    
    // Function to update the position of an active fretless note
    function updateFretlessNotePosition(stringIndex, position) {
        // Clamp position to 0-1
        position = Math.max(0, Math.min(1, position));
        
        // Get the base note and calculate the offset
        const baseNote = bassStringNotes[stringIndex];
        const maxSemitones = 24; // Two octaves range
        let midiOffset = position * maxSemitones;
        
        // Round to the nearest cent for microtonal effects
        const cents = Math.round(midiOffset * 100);
        midiOffset = cents / 100;
        
        const midiNote = baseNote + midiOffset;
        
        // Show position information - keep empty
        const positionElement = document.getElementById('note-position');
        if (positionElement) {
            positionElement.textContent = '';
        }
        
        // Update the dot position
        const noteName = calculateNoteNameWithCents(midiNote);
        updateNoteDotPosition(stringIndex, position, noteName);
        
        // Update the current note display - keep empty
        const currentBassNoteElement = document.getElementById('current-bass-note');
        if (currentBassNoteElement) {
            currentBassNoteElement.textContent = '';
        }
        
        // Get the previous note info
        const previousInfo = activeStringElements.get(stringIndex);
        if (!previousInfo) return;
        
        // If the note has changed by more than 1 cent, handle it as a new note
        // This prevents stuck notes when sliding
        const previousMidiNote = previousInfo.midiNote;
        
        if (Math.abs(previousMidiNote - midiNote) >= 0.01) {
            // Release the previous note if it's significantly different
            handleNoteOff(previousMidiNote);
            
            // Trigger the new note with the current velocity
            handleNoteOn(midiNote, 0.8);
            
            // Log the note transition
            console.log(`Sliding from ${previousMidiNote.toFixed(2)} to ${midiNote.toFixed(2)}`);
        } else {
            // For very small movements, just use the pitch bend/glide
            handleNoteSlide(previousMidiNote, midiNote);
        }
        
        // Update the active note info with new position and MIDI note
        activeStringElements.set(stringIndex, {
            position: position,
            midiNote: midiNote,
            stringElement: previousInfo.stringElement,
            noteDot: previousInfo.noteDot
        });
    }
    
    // Update the note dot position
    function updateNoteDotPosition(stringIndex, position) {
        const stringElement = document.querySelector(`.bass-string[data-string="${stringIndex}"]`);
        if (!stringElement) return;
        
        const noteDot = stringElement.querySelector('.note-dot');
        if (!noteDot) return;
        
        // The dot is appearing to the left of the cursor because the transform: translate(-50%, -50%)
        // shifts the dot left by 50% of its width, so we need to account for that
        
        // Calculate exact pixel position within the string
        const stringWidth = stringElement.getBoundingClientRect().width;
        
        // Position dot directly where the click happened, no additional offsets needed
        // CSS transform will handle the centering
        noteDot.style.left = `${position * 100}%`;
        noteDot.style.top = '50%';
        
        // For debugging
        console.log(`Note dot placed at ${position * 100}% on string ${stringIndex}`);
    }
    
    // Function to release a fretless note
    function releaseFretlessNote(stringIndex) {
        const info = activeStringElements.get(stringIndex);
        if (!info) return;
        
        // Remove the active class from the note dot
        if (info.noteDot) {
            info.noteDot.classList.remove('active');
            info.noteDot.textContent = ''; // Clear the note name text
        }
        
        // Remove the active class from the string
        if (info.stringElement) {
            info.stringElement.classList.remove('active');
        }
        
        // Get the MIDI note to release
        const midiNote = info.midiNote;
        
        // Remove from the active notes map
        activeStringElements.delete(stringIndex);
        
        // Update displays - keep both empty
        if (activeStringElements.size === 0) {
            const currentBassNoteElement = document.getElementById('current-bass-note');
            if (currentBassNoteElement) {
                currentBassNoteElement.textContent = '';
            }
            
            const positionElement = document.getElementById('note-position');
            if (positionElement) {
                positionElement.textContent = '';
            }
        }
        
        // Make sure to cancel any scheduled ramps to avoid stuck notes
        if (vco1 && vco2) {
            try {
                vco1.frequency.cancelScheduledValues(audioContext.currentTime);
                vco2.frequency.cancelScheduledValues(audioContext.currentTime);
            } catch (e) {
                console.warn('Error canceling frequency ramps:', e);
            }
        }
        
        // Trigger note off (will handle MIDI light release)
        handleNoteOff(midiNote);
        
        // For safety, also trigger a global note-off for all active notes
        // This helps prevent stuck notes when sliding rapidly
        if (activeNotes.size > 0) {
            console.log('Cleaning up any potentially stuck notes');
            const activeNotesArray = Array.from(activeNotes);
            activeNotesArray.forEach(note => {
                handleNoteOff(note);
            });
            activeNotes.clear();
        }
        
        console.log(`Released fretless note: string ${stringIndex}, MIDI note ${midiNote.toFixed(2)}`);
    }
    
    // Function to calculate note name from MIDI note number with cents
    function calculateNoteNameWithCents(midiNote) {
        const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        
        // Get the whole number part
        const wholeMidiNote = Math.floor(midiNote);
        const cents = Math.round((midiNote - wholeMidiNote) * 100);
        
        // Calculate the standard note name
        const octave = Math.floor(wholeMidiNote / 12) - 1;
        const noteIndex = wholeMidiNote % 12;
        const noteName = noteNames[noteIndex];
        
        // Special case for the E1-F1 boundary
        if (midiNote >= 28 && midiNote < 29) {
            // If we're between E1 and F1
            if (cents > 0) {
                return `E1 +${cents}¢`;
            } else {
                return `E1`;
            }
        }
        
        // Add cents information if needed
        if (cents > 0) {
            return `${noteName}${octave} +${cents}¢`;
        } else {
            return `${noteName}${octave}`;
        }
    }
    
    // Handle note sliding (portamento)
    function handleNoteSlide(fromMidiNote, toMidiNote) {
        // Skip if the notes are identical to prevent unnecessary slides
        if (fromMidiNote === toMidiNote) return;

        // Update oscillator frequencies with glide
        if (vco1 && vco2) {
            const fromFreq = midiToFreq(fromMidiNote);
            const toFreq = midiToFreq(toMidiNote);
            
            // Use exponential ramp for more natural pitch slides
            const glideTime = parseFloat(glideSlider.value);
            
            // Ensure the frequencies are valid and positive to avoid errors
            if (fromFreq > 0 && toFreq > 0) {
                try {
                    vco1.frequency.cancelScheduledValues(audioContext.currentTime);
                    vco2.frequency.cancelScheduledValues(audioContext.currentTime);
                    
                    vco1.frequency.exponentialRampToValueAtTime(toFreq, audioContext.currentTime + glideTime);
                    vco2.frequency.exponentialRampToValueAtTime(toFreq, audioContext.currentTime + glideTime);
                    
                    console.log(`Sliding pitch from ${fromFreq.toFixed(2)}Hz to ${toFreq.toFixed(2)}Hz over ${glideTime}s`);
                } catch (e) {
                    console.warn('Error during frequency slide:', e);
                    
                    // Fallback to immediate frequency setting
                    vco1.frequency.value = toFreq;
                    vco2.frequency.value = toFreq;
                }
            } else {
                // Fallback for invalid frequencies
                console.warn(`Invalid frequency values for slide: ${fromFreq}, ${toFreq}`);
                vco1.frequency.value = toFreq > 0 ? toFreq : 440;
                vco2.frequency.value = toFreq > 0 ? toFreq : 440;
            }
        }
    }

    // Set up event listeners for the open strings
    const openStrings = document.querySelectorAll('.open-string');
    openStrings.forEach(openString => {
        const stringIndex = parseInt(openString.dataset.string, 10);
        
        // Add mousedown/up handlers for open strings
        openString.addEventListener('mousedown', () => {
            playOpenString(stringIndex);
        });
        
        openString.addEventListener('mouseup', () => {
            releaseOpenString(stringIndex);
        });
        
        openString.addEventListener('mouseleave', () => {
            releaseOpenString(stringIndex);
        });
        
        // Touch support
        openString.addEventListener('touchstart', (e) => {
            e.preventDefault();
            playOpenString(stringIndex);
        });
        
        openString.addEventListener('touchend', (e) => {
            e.preventDefault();
            releaseOpenString(stringIndex);
        });
    });
    
    // Function to play an open string (fret 0)
    function playOpenString(stringIndex) {
        // An open string is just fret 0
        const baseNote = bassStringNotes[stringIndex];
        const midiNote = baseNote; // fret 0 = base note
        const noteName = calculateNoteNameWithCents(midiNote);
        
        // Add active class to the open string element
        const openString = document.querySelector(`.open-string[data-string="${stringIndex}"]`);
        if (openString) {
            openString.classList.add('active');
        }
        
        // Get the string element and activate its note dot at position 0
        const stringElement = document.querySelector(`.bass-string[data-string="${stringIndex}"]`);
        if (stringElement) {
            stringElement.classList.add('active');
            const noteDot = stringElement.querySelector('.note-dot');
            if (noteDot) {
                updateNoteDotPosition(stringIndex, 0, noteName);
                noteDot.classList.add('active');
            }
        }
        
        // Store note information in the active elements map
        activeStringElements.set(stringIndex, {
            position: 0,
            midiNote: midiNote,
            stringElement: stringElement,
            noteDot: stringElement?.querySelector('.note-dot')
        });
        
        // Blank out the text displays
        const currentBassNoteElement = document.getElementById('current-bass-note');
        if (currentBassNoteElement) {
            currentBassNoteElement.textContent = '';
        }
        
        const positionElement = document.getElementById('note-position');
        if (positionElement) {
            positionElement.textContent = '';
        }
        
        // Activate MIDI light with note-on behavior
        activateMidiLight(true);
        
        // Trigger the note using the synth's note handling
        handleNoteOn(midiNote, 0.8);
        
        console.log(`Playing open string: ${stringIndex}, MIDI note ${midiNote} (${noteName})`);
    }
    
    // Function to release an open string
    function releaseOpenString(stringIndex) {
        // Remove active class from the open string element
        const openString = document.querySelector(`.open-string[data-string="${stringIndex}"]`);
        if (openString) {
            openString.classList.remove('active');
        }
        
        // Also clear the note dot
        const stringElement = document.querySelector(`.bass-string[data-string="${stringIndex}"]`);
        if (stringElement) {
            stringElement.classList.remove('active');
            const noteDot = stringElement.querySelector('.note-dot');
            if (noteDot) {
                noteDot.classList.remove('active');
                noteDot.textContent = '';
            }
        }
        
        // Get the MIDI note for this string
        const midiNote = bassStringNotes[stringIndex];
        
        // Remove from active elements
        activeStringElements.delete(stringIndex);
        
        // Update displays
        if (activeStringElements.size === 0) {
            const currentBassNoteElement = document.getElementById('current-bass-note');
            if (currentBassNoteElement) {
                currentBassNoteElement.textContent = '';
            }
            
            const positionElement = document.getElementById('note-position');
            if (positionElement) {
                positionElement.textContent = '';
            }
        }
        
        // Trigger note off (will handle MIDI light release)
        handleNoteOff(midiNote);
        
        console.log(`Released open string: ${stringIndex}, MIDI note ${midiNote} (${calculateNoteNameWithCents(midiNote)})`);
    }

    // Update the note dot position
    function updateNoteDotPosition(stringIndex, position, noteName) {
        const stringElement = document.querySelector(`.bass-string[data-string="${stringIndex}"]`);
        if (!stringElement) return;
        
        const noteDot = stringElement.querySelector('.note-dot');
        if (!noteDot) return;
        
        // Position dot directly where the click happened
        noteDot.style.left = `${position * 100}%`;
        noteDot.style.top = '50%';
        
        // Set the note name text inside the dot
        if (noteName) {
            noteDot.textContent = noteName;
        }
        
        // For debugging
        console.log(`Note dot placed at ${position * 100}% on string ${stringIndex}`);
    }

    // Actually play the fretless note
    function actuallyPlayFretlessNote(stringIndex, position) {
        // Ensure the position is between 0 and 1
        position = Math.max(0, Math.min(1, position));
        
        // Get the string element
        const stringElement = document.querySelector(`.bass-string[data-string="${stringIndex}"]`);
        if (!stringElement) {
            console.error(`String element not found for string index ${stringIndex}`);
            return;
        }
        
        // Get the note dot element
        const noteDot = stringElement.querySelector('.note-dot');
        if (!noteDot) {
            console.error(`Note dot not found for string ${stringIndex}`);
            return;
        }
        
        // Get MIDI note based on position
        const baseNote = bassStringNotes[stringIndex];
        const maxSemitones = 24; // Two octaves range on the string
        let midiOffset = position * maxSemitones;
        
        // Round to the nearest cent (for microtonal effects)
        const cents = Math.round(midiOffset * 100);
        midiOffset = cents / 100;
        
        const midiNote = baseNote + midiOffset;
        const noteName = calculateNoteNameWithCents(midiNote);
        
        // Update the dot position and make it active
        updateNoteDotPosition(stringIndex, position, noteName);
        noteDot.classList.add('active');
        
        // Mark the string as active
        stringElement.classList.add('active');
        
        // Store active note information
        activeStringElements.set(stringIndex, {
            position: position,
            midiNote: midiNote,
            stringElement: stringElement,
            noteDot: noteDot
        });
        
        // Update the current note display - keep this empty now
        const currentBassNoteElement = document.getElementById('current-bass-note');
        if (currentBassNoteElement) {
            currentBassNoteElement.textContent = '';
        }
        
        // Show position information - keep this empty now
        const positionElement = document.getElementById('note-position');
        if (positionElement) {
            positionElement.textContent = '';
        }
        
        // Activate the MIDI light with note-on behavior
        activateMidiLight(true);
        
        // Trigger the note using the synth's existing note handling
        handleNoteOn(midiNote, 0.8);
        
        console.log(`Playing fretless note: string ${stringIndex}, position ${position.toFixed(2)}, MIDI note ${midiNote.toFixed(2)} (${noteName})`);
    }

    // ===== Title Click Randomizer =====
    
    // Function to randomize all synth settings
    function randomizeSynthSettings() {
        console.log('Randomizing all synth settings!');
        
        try {
            // Add a visual indication that randomization is happening
            const modules = document.querySelectorAll('.module');
            console.log(`Found ${modules.length} modules to animate`);
            
            // Add the animation class to all modules
            modules.forEach(module => {
                module.classList.add('module-randomizing');
            });
            
            // Remove the animation class after it completes
            setTimeout(() => {
                modules.forEach(module => {
                    module.classList.remove('module-randomizing');
                });
            }, 600); // Animation takes 500ms + buffer
            
            // Randomize sliders
            const sliders = document.querySelectorAll('input[type="range"]');
            console.log(`Found ${sliders.length} sliders to randomize`);
            
            sliders.forEach(slider => {
                if (slider.id) { // Skip any sliders without IDs
                    const min = parseFloat(slider.min);
                    const max = parseFloat(slider.max);
                    let randomValue;
                    
                    // Special handling for specific controls
                    if (slider.id === 'amp-sustain') {
                        // Bias toward higher sustain values (0.4-1.0) to avoid too many short sounds
                        randomValue = Math.random() * 0.6 + 0.4;
                    } else if (slider.id === 'filter-cutoff') {
                        // Bias towards middle values for filter cutoff (avoid extremes)
                        randomValue = min + (Math.random() * 0.6 + 0.2) * (max - min);
                    } else {
                        // Standard random value within range
                        randomValue = min + Math.random() * (max - min);
                    }
                    
                    console.log(`Setting ${slider.id} to ${randomValue} (range: ${min}-${max})`);
                    
                    // Set the new value
                    slider.value = randomValue;
                    
                    // Manually trigger input event to update displays and internal state
                    const event = new Event('input', { bubbles: true });
                    slider.dispatchEvent(event);
                }
            });
            
            // Randomize dropdowns
            const selects = document.querySelectorAll('select');
            console.log(`Found ${selects.length} dropdowns to randomize`);
            
            selects.forEach(select => {
                if (select.id && select.options.length > 0 && select.id !== 'midi-input') {
                    // Skip MIDI input selector
                    const randomIndex = Math.floor(Math.random() * select.options.length);
                    console.log(`Setting ${select.id} to option ${randomIndex} of ${select.options.length}`);
                    
                    select.selectedIndex = randomIndex;
                    
                    // Manually trigger change event
                    const event = new Event('change', { bubbles: true });
                    select.dispatchEvent(event);
                }
            });
            
            // Update all displays after randomization
            if (typeof updateAllDisplays === 'function') {
                console.log('Updating all displays');
                updateAllDisplays();
            }
            
            // Redraw envelopes
            if (typeof initEnvelopeVisualization === 'function') {
                console.log('Redrawing envelopes');
                initEnvelopeVisualization('filter', document.getElementById('filter-env-canvas'));
                initEnvelopeVisualization('amp', document.getElementById('amp-env-canvas'));
            } else {
                console.warn('initEnvelopeVisualization function not found');
            }
            
            // Play a quick sound to demonstrate the new settings
            if (audioStarted && vco1 && vco2 && ampEnv && filterEnv) {
                console.log('Playing demo note');
                const demoNote = 60; // Middle C
                setTimeout(() => {
                    // Play a quick note to demonstrate new settings
                    handleNoteOn(demoNote, 0.7);
                    setTimeout(() => {
                        handleNoteOff(demoNote);
                    }, 500);
                }, 700); // Wait for animation to finish
            } else {
                console.warn('Audio not started or components not initialized, skipping demo note');
            }
            
        } catch (error) {
            console.error('Error in randomizeSynthSettings:', error);
        }
    }
    
    // Attach direct event listener to title image (as early as possible)
    console.log('Setting up title image click handler directly');
    setTimeout(() => {
        const titleImage = document.querySelector('.title-image') || document.getElementById('title-image');
        console.log('Direct title image query:', titleImage);
        if (titleImage) {
            titleImage.addEventListener('click', function(e) {
                console.log('Title clicked directly!', e);
                this.classList.add('title-flapping');
                setTimeout(() => {
                    this.classList.remove('title-flapping');
                }, 500);
                randomizeSynthSettings();
            });
            
            // Make sure the cursor style is applied
            titleImage.style.cursor = 'pointer';
        }
    }, 1000); // Wait 1 second to ensure the DOM is ready
    
    // ===== Bass Guitar Module =====
});
