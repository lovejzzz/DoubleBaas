# Web SEM Synth

A browser-based monophonic synthesizer inspired by classic analog synthesizers, built with Web Audio API (Tone.js).

![Web SEM Synth](title.png)

## Features

- **Dual Oscillator Engine**: Two voltage-controlled oscillators (VCOs) with sawtooth, pulse, and triangle waveforms
- **State Variable Filter**: 12dB/octave filter with continuous morphing between lowpass, notch, and highpass modes
- **Dual ADSR Envelopes**: Separate envelopes for amplitude and filter modulation with interactive visualization
- **LFO Modulation**: Low-frequency oscillator for vibrato, filter modulation, and pulse-width modulation
- **MIDI Support**: Connect and play with any MIDI controller
- **Responsive Design**: Works on desktop and mobile devices

## Technical Details

- Built with vanilla JavaScript and the Tone.js library
- Uses the Web Audio API for high-performance, low-latency audio processing
- Implements a monophonic architecture with portamento (glide)
- Features interactive envelope visualizations using HTML5 Canvas

## Usage

1. Open the application in a web browser
2. Audio will start automatically on your first interaction with the page
3. Connect a MIDI controller or use your computer keyboard (if implemented)
4. Adjust parameters using the intuitive interface

## Controls

### Global Controls
- Master Volume: Controls the overall output level
- Glide Time: Adjusts the portamento time between notes
- MIDI Input: Select your MIDI controller

### Oscillators (VCO 1 & VCO 2)
- Waveform: Select between sawtooth, pulse, and triangle waves
- Fine Tune: Adjust the pitch in cents (+/- 50 cents)
- PWM Depth: Control the pulse width modulation depth (for pulse waveform)
- Level: Set the oscillator volume in the mix

### Filter
- Cutoff Frequency: Control the filter cutoff point
- Resonance (Q): Adjust the filter resonance
- LP/Notch/HP Sweep: Morph between filter types
- Envelope Amount: Control how much the filter envelope affects the cutoff
- LFO Amount: Set the depth of LFO modulation on the filter

### Envelopes
- Attack: Time for the envelope to reach maximum level
- Decay: Time for the envelope to fall to sustain level
- Sustain: Level maintained while a key is held
- Release: Time for the envelope to return to zero after key release

### LFO
- Waveform: Select between triangle, sine, square, and sawtooth
- Rate: Control the speed of the LFO (0.1 - 30 Hz)
- Vibrato Depth: Set the amount of pitch modulation

## Development

This project was developed as part of the Sound and Embedded Media course at NYU. It demonstrates the principles of subtractive synthesis and digital signal processing using web technologies.

## License

MIT License

## Credits

- Built with [Tone.js](https://tonejs.github.io/)
- Inspired by classic analog synthesizers like the SEM (Synthesizer Expander Module)
