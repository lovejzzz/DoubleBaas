document.addEventListener('DOMContentLoaded', () => {
    // --- Envelope Visualization ---
    // We'll initialize the envelope visualizations after the audio context is started
    // to ensure all DOM elements are fully loaded and accessible

    // --- Global References ---
    let audioStarted = false;
    let vco1, vco2, vco1Gain, vco2Gain;
    let filterLp, filterHp, filterSweepXFade;
    let filterEnv, ampEnv;
    let lfo;
    let masterVolume;
    let currentNote = null; // Simple monophonic tracking
    const pitchBendRange = 2; // Semitones for pitch bend +/-

    // LFO->Parameter Gain Nodes (for controlling modulation depth)
    let lfoFilterModGain, lfoVco1PwmGain, lfoVco2PwmGain, lfoVibratoGain;
    let filterEnvMod; // Declare filterEnvMod here

    // === DOM Element References ===
    const startButton = document.getElementById('start-audio');
    const midiInputSelector = document.getElementById('midi-input');
    const masterVolumeSlider = document.getElementById('master-volume');
    const glideSlider = document.getElementById('glide');

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
        // Get all control groups
        const controlGroups = document.querySelectorAll('.control-group');
        
        // For each control group, find the input and its associated value display
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

    // State object for MIDI
    const midiState = {
        currentInput: null // Reference to the currently selected MIDI input device
    };

    // --- Main Audio Setup Function ---
    async function setupAudio() {
        if (audioStarted) return;
        await Tone.start();
        console.log('Audio Context Started');
        audioStarted = true;
        startButton.disabled = true;
        
        // Initialize the display elements
        initializeDisplays();
        
        // Initialize envelope visualizations after audio context is started
        const filterEnvCanvas = document.getElementById('filter-env-canvas');
        const ampEnvCanvas = document.getElementById('amp-env-canvas');
        
        console.log('Filter canvas:', filterEnvCanvas);
        console.log('Amp canvas:', ampEnvCanvas);
        
        if (filterEnvCanvas && ampEnvCanvas) {
            console.log("Initializing envelope visualizations");
            
            // Initialize with a slight delay to ensure canvases are ready
            setTimeout(() => {
                console.log("Drawing filter envelope");
                initEnvelopeVisualization('filter', filterEnvCanvas);
                
                console.log("Drawing amp envelope");
                initEnvelopeVisualization('amp', ampEnvCanvas);
                
                // Force a redraw of both envelopes
                console.log("Forcing redraw of envelopes");
            }, 100);
        } else {
            console.error("Could not find envelope canvases");
        }
        startButton.textContent = 'Audio Running';

        // === Create Audio Nodes ===
        masterVolume = new Tone.Gain(parseFloat(masterVolumeSlider.value)).toDestination();

        // Envelopes (using default values from HTML initially)
        filterEnv = new Tone.Envelope({
            attack: parseFloat(filterAttackSlider.value), decay: parseFloat(filterDecaySlider.value),
            sustain: parseFloat(filterSustainSlider.value), release: parseFloat(filterReleaseSlider.value),
            attackCurve: 'exponential', releaseCurve: 'exponential'
        });
        ampEnv = new Tone.AmplitudeEnvelope({
            attack: parseFloat(ampAttackSlider.value), decay: parseFloat(ampDecaySlider.value),
            sustain: parseFloat(ampSustainSlider.value), release: parseFloat(ampReleaseSlider.value),
            attackCurve: 'exponential', releaseCurve: 'exponential'
        }).connect(masterVolume);


        // Filter Section (Sweepable LP/HP via Crossfade)
        const initialCutoffFreq = midiToFreq(parseFloat(filterCutoffSlider.value));
        const initialQ = parseFloat(filterQSlider.value);
        filterLp = new Tone.Filter({ frequency: initialCutoffFreq, type: 'lowpass', rolloff: -12, Q: initialQ });
        filterHp = new Tone.Filter({ frequency: initialCutoffFreq, type: 'highpass', rolloff: -12, Q: initialQ });
        filterSweepXFade = new Tone.CrossFade(parseFloat(filterSweepSlider.value)).connect(ampEnv); // Connect to Amp Env INSTEAD of master vol
        filterLp.connect(filterSweepXFade.a);
        filterHp.connect(filterSweepXFade.b);

        // Filter Env Amount (Bipolar) - Scales envelope output before adding to filter freq
        const filterEnvModScale = 6000; // Max Hz sweep range for the filter envelope (adjust as needed)
        filterEnvMod = new Tone.Scale(0, filterEnvModScale); // Initialize the outer scope variable
        filterEnv.connect(filterEnvMod);
        filterEnvMod.connect(filterLp.detune); // Modulate filter detune (in cents)
        filterEnvMod.connect(filterHp.detune);

        // Oscillators
        vco1 = new Tone.Oscillator({ // Use standard Oscillator for now
             frequency: 440, // Default frequency
             detune: parseFloat(vco1DetuneSlider.value),
             type: vco1WaveSelect.value // Set initial type directly
         });

        vco2 = new Tone.Oscillator({
             frequency: 440,
             detune: parseFloat(vco2DetuneSlider.value),
             type: vco2WaveSelect.value
         });

        // Oscillator Gains (Mixer) - connect VCOs to Gains, Gains to *both* filters
        vco1Gain = new Tone.Gain(parseFloat(mixVco1Slider.value)); 
        vco2Gain = new Tone.Gain(parseFloat(mixVco2Slider.value)); 
        // Correct connections: Gain output goes to BOTH filters independently
        vco1Gain.connect(filterLp);
        vco1Gain.connect(filterHp);
        vco2Gain.connect(filterLp);
        vco2Gain.connect(filterHp);

        vco1.connect(vco1Gain);
        vco2.connect(vco2Gain);

        // LFO
        lfo = new Tone.LFO({
            frequency: parseFloat(lfoRateSlider.value),
            type: lfoWaveSelect.value,
            min: -1, // Bipolar for vibrato/filter mod
            max: 1
        }).start(); // Start LFO immediately

        // LFO Routing Gain Nodes (initialize with UI values)
        const initialFilterLfoModHz = 3000; // Max LFO sweep in Hz
        lfoFilterModGain = new Tone.Scale(0, initialFilterLfoModHz); // Will be scaled by slider later
        lfo.connect(lfoFilterModGain);
        lfoFilterModGain.connect(filterLp.detune); // Modulate filter detune/offset
        lfoFilterModGain.connect(filterHp.detune);

        // LFO -> PWM Depth (Scale -1 to 1 LFO output to Pulse Width range 0 to ~0.9)
        // Note: PulseOscillator width is 0-1. LFO is -1 to 1. We need bipolar scaling.
        lfoVco1PwmGain = new Tone.Scale(0, 0.45); // Max width deviation
        lfo.connect(lfoVco1PwmGain);
        //lfoVco1PwmGain.connect(vco1.width); // PWM TEMPORARILY DISABLED

        lfoVco2PwmGain = new Tone.Scale(0, 0.45); // Max width deviation
        lfo.connect(lfoVco2PwmGain);
        //lfoVco2PwmGain.connect(vco2.width); // PWM TEMPORARILY DISABLED

        // LFO -> Vibrato (Scale LFO +/-1 to +/- cents)
        lfoVibratoGain = new Tone.Scale(0, parseFloat(lfoVibratoDepthSlider.value)); // +/- Cents
        lfo.connect(lfoVibratoGain);
        lfoVibratoGain.connect(vco1.detune); // Add LFO modulation to base detune
        lfoVibratoGain.connect(vco2.detune);

        // Start Oscillators
        vco1.start();
        vco2.start();

        // === Connect UI Controls ===
        connectUI();
        updateAllDisplays(); // Set initial display values

        // === Setup MIDI ===
        setupMIDI();
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
        // Simple exponential mapping from slider range (1-127) to frequency (e.g., 20Hz - 18kHz)
        const minLog = Math.log(20);
        const maxLog = Math.log(18000);
        const scale = (maxLog - minLog) / (127 - 1);
        return Math.exp(minLog + scale * (midiVal - 1));
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
     }


    // --- MIDI Handling ---
    function setupMIDI() {
        if (navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess({ sysex: false }) // Sysex not needed
                .then(onMIDISuccess, onMIDIFailure);
        } else {
            console.warn("WebMIDI is not supported in this browser.");
            midiInputSelector.innerHTML = '<option>Not Supported</option>';
            midiInputSelector.disabled = true;
        }
    }

    function onMIDISuccess(midiAccess) {
        console.log("MIDI ready!");
        let inputs = midiAccess.inputs;
        if (inputs.size === 0) {
            midiInputSelector.innerHTML = '<option>No MIDI devices found</option>';
            midiInputSelector.disabled = true;
            return;
        }

        midiInputSelector.innerHTML = '<option value="">-- Select MIDI Device --</option>'; // Placeholder
        inputs.forEach(input => {
            const option = document.createElement('option');
            option.value = input.id;
            option.text = input.name;
            midiInputSelector.appendChild(option);
            console.log(`Found MIDI input: ID=${input.id}, Name=${input.name}`);
        });
         midiInputSelector.disabled = false; // Enable dropdown

        autoSelectMIDIInput(midiAccess); // Attempt to auto-select first input

        midiAccess.onstatechange = (event) => {
             console.log(`MIDI state change: ${event.port.name} state: ${event.port.state}`);
             // Rescan and populate MIDI inputs on change
            // Clear current selection and listeners before repopulating
            midiInputSelector.value = ""; // Reset dropdown
            onMIDISuccess(midiAccess); // Repopulate
        };
    }


    function onMIDIFailure(msg) {
        console.error(`Failed to get MIDI access - ${msg}`);
         midiInputSelector.innerHTML = '<option>MIDI Access Failed</option>';
         midiInputSelector.disabled = true;
    }

    function handleMIDIMessage(event) {
        if (!audioStarted) return; // Don't process MIDI if audio not started

        console.log("handleMIDIMessage received data:", event.data);

        const command = event.data[0] >> 4; // Command is the upper nibble (e.g., 9=NoteOn, 8=NoteOff, 11=CC, 14=PitchBend)
        const channel = event.data[0] & 0xf; // Channel is the lower nibble (0-15)
        const data1 = event.data[1]; // Note number or CC number
        const data2 = event.data.length > 2 ? event.data[2] : 0; // Velocity or CC value

        const time = Tone.now(); // Use Tone.now() for precise timing

        switch (command) {
            case 9: // Note On
                if (data2 > 0) { // Velocity > 0 means Note On
                    console.log("Note On detected in handleMIDIMessage");
                    noteOn(data1, data2, time);
                } else {
                    // Some controllers send Note On with velocity 0 for Note Off
                    noteOff(data1, time);
                }
                break;
            case 8: // Note Off
                noteOff(data1, time);
                break;
            case 11: // Control Change (CC)
                handleCC(data1, data2); // data1=CC number, data2=CC value
                break;
            case 14: // Pitch Bend
                // Combine MSB and LSB for pitch bend value
                const bendValue = ((data2 << 7) | data1) - 8192; // Range -8192 to +8191
                handlePitchBend(bendValue, time);
                break;
        }
    }

    function noteOn(midiNote, velocity, time) {
        console.log(`Note On: ${midiNote}, Vel: ${velocity}`);
        currentNote = midiNote;
        const freq = Tone.Frequency(midiNote, "midi").toFrequency();
        const velNorm = velocity / 127;

        // Set oscillator frequencies (with portamento respecting glide time)
        if (vco1) vco1.frequency.rampTo(freq, parseFloat(glideSlider.value));
        if (vco2) vco2.frequency.rampTo(freq, parseFloat(glideSlider.value));

        // Trigger envelopes
        // Scale amp envelope output by velocity (adjust curve to taste)
        const ampModVelocity = Math.pow(velNorm, 1.5) * 0.8 + 0.2; // Make velocity more expressive
        if(ampEnv) ampEnv.triggerAttack(time, ampModVelocity);
        if(filterEnv) filterEnv.triggerAttack(time); // Filter env usually not velocity sensitive on SEM?
    }

    function noteOff(midiNote, time) {
        // Only trigger release if this is the currently playing note (simple monophony)
        if (midiNote === currentNote) {
            console.log(`Note Off: ${midiNote}`);
            if(ampEnv) ampEnv.triggerRelease(time);
            if(filterEnv) filterEnv.triggerRelease(time);
            currentNote = null; // Ready for a new note
        } else {
            console.log(`Note Off received for ${midiNote}, but current note is ${currentNote}. Ignoring.`);
        }
    }

    function handlePitchBend(bendValue, time) {
        if (!vco1 || !vco2) return;
        // Map bend value (-8192 to 8191) to pitch shift in cents
        // pitchBendRange is in semitones (+/-)
        const cents = (bendValue / 8191) * pitchBendRange * 100;

        // Apply the bend relative to the current note's frequency
        // This requires calculating the target frequency based on the current note and bend
        if (currentNote !== null) {
            const baseFreq = Tone.Frequency(currentNote, "midi").toFrequency();
            const bentFreq = baseFreq * Math.pow(2, cents / 1200);
            // Ramp to the bent frequency smoothly (use a small ramp time)
            vco1.frequency.rampTo(bentFreq, 0.05);
            vco2.frequency.rampTo(bentFreq, 0.05);
        } else {
            // If no note is playing, maybe just update the base detune? Or ignore?
            // For now, let's ignore pitch bend if no note is active.
        }
    }

    function handleCC(ccNumber, ccValue) {
        console.log(`CC Received: Num=${ccNumber}, Val=${ccValue}`);
        // TODO: Map CC messages to synth parameters
        // Example: Map CC 74 (usually Filter Cutoff) to filterCutoffSlider
        // if (ccNumber === 74) {
        //     const sliderValue = Math.round((ccValue / 127) * (filterCutoffSlider.max - filterCutoffSlider.min) + parseFloat(filterCutoffSlider.min));
        //     filterCutoffSlider.value = sliderValue;
        //     filterCutoffSlider.dispatchEvent(new Event('input')); // Trigger update
        // }
    }

    function autoSelectMIDIInput(accessParam) { // Accept access object as parameter
        if (!accessParam) {
            console.error("autoSelectMIDIInput called without valid access object.");
            return;
        }

        const inputs = accessParam.inputs.values();
        const firstInput = inputs.next().value; // Get the first input device

        if (firstInput) {
            console.log(`Auto-selecting MIDI input: ${firstInput.name || firstInput.id}`);
            midiInputSelector.value = firstInput.id; // Update dropdown display
            startListening(accessParam, firstInput.id); // Pass accessParam AND deviceId
        } else {
            console.log("No MIDI input devices found for auto-selection.");
            // Optionally disable the dropdown or show a message
             midiInputSelector.disabled = true;
             const option = new Option("No MIDI devices detected", "");
             midiInputSelector.innerHTML = ''; // Clear existing options
             midiInputSelector.add(option);
        }
    }

    function startListening(accessParam, deviceId) { // Add accessParam parameter
        if (!accessParam || !deviceId) {
            console.error("startListening called with invalid parameters", accessParam, deviceId);
            return;
        }

        console.log(`Attempting to start listening on device ID: ${deviceId}`);

        // Remove listener from previous input if any
        if (midiState.currentInput && midiState.currentInput.onmidimessage) {
            console.log(`Stopping listener on ${midiState.currentInput.name}`);
            midiState.currentInput.onmidimessage = null;
        }

        midiState.currentInput = accessParam.inputs.get(deviceId);

        if (midiState.currentInput) {
            console.log(`Found device: ${midiState.currentInput.name || midiState.currentInput.id}. Attaching listener.`);
            midiState.currentInput.onmidimessage = handleMIDIMessage;
        } else {
            console.error(`MIDI input device with ID ${deviceId} not found.`);
            midiState.currentInput = null;
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
            
            // Set default styles
            ctx.strokeStyle = '#4f8eff';
            ctx.lineWidth = 2;
            ctx.fillStyle = 'rgba(79, 142, 255, 0.2)';
            
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
            ctx.fillStyle = '#ffffff';
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
            ctx.fillStyle = '#4f8eff'; // Explicit color instead of CSS variable
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            
            // Add a highlight ring for better visibility
            ctx.beginPath();
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }
    
    // --- Initialization ---
    // Auto-start audio context when page loads
    document.addEventListener('click', async function initAudio() {
        await setupAudio();
        document.removeEventListener('click', initAudio);
    }, { once: true });
    
    // Initialize displays on page load
    initializeDisplays();
    
    // Initial display update for non-audio-dependent controls
    updateAllDisplays();
    
    // Hide the start button since we'll auto-start on first interaction
    startButton.textContent = 'Audio will start automatically on first interaction';
    startButton.style.fontSize = '0.8em';

});
