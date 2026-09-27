/* User-provided launch reference, synchronized to the launch animation timeline. */
(() => {
  'use strict';
  const url = 'assets/audio/interceptor/launch-first-10s.mp3';
  let context, buffer, loading, source;
  let active = false, paused = false, elapsed = 0, startedAt = 0, error = null;
  const time = () => elapsed + (active && !paused ? (performance.now() - startedAt) / 1000 : 0);
  function releaseSource() {
    if (!source) return;
    const old = source; source = null; old.onended = null;
    try { old.stop(); } catch (_) { /* Already ended. */ }
    old.disconnect();
  }
  function playAvailable() {
    if (!active || paused || !buffer || !context || context.state !== 'running' || source) return;
    const offset = time();
    if (offset >= Math.min(10, buffer.duration)) return;
    const next = context.createBufferSource();
    next.buffer = buffer; next.connect(context.destination); source = next;
    next.onended = () => { if (source === next) { source = null; next.disconnect(); } };
    next.start(0, offset, Math.min(10, buffer.duration) - offset);
  }
  function prepare() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return Promise.resolve(null);
      context ||= new AudioContext();
      context.resume().then(playAvailable).catch(e => { error = e.message; });
      if (!loading) {
        loading = fetch(url).then(response => {
          if (!response.ok) throw new Error(`Launch audio HTTP ${response.status}`);
          return response.arrayBuffer();
        }).then(data => context.decodeAudioData(data)).then(decoded => {
          buffer = decoded; error = null; playAvailable(); return decoded;
        }).catch(e => { error = e.message; loading = null; return null; });
      }
      return loading;
    } catch (e) { error = e.message; return Promise.resolve(null); }
  }
  function stop() {
    active = false; elapsed = 0; paused = false; releaseSource();
  }
  function start() {
    stop(); active = true; startedAt = performance.now();
    prepare(); playAvailable();
  }
  function setPaused(value) {
    value = !!value;
    if (!active || paused === value) return;
    if (value) { elapsed = time(); paused = true; releaseSource(); }
    else { paused = false; startedAt = performance.now(); prepare(); playAvailable(); }
  }
  window.TactixLaunchAudio = Object.freeze({ prepare, start, stop, setPaused,
    snapshot: () => ({ active, paused, playing: !!source, elapsed: time(), loaded: !!buffer,
      duration: buffer ? buffer.duration : null, contextState: context ? context.state : null, error, url })
  });
})();
