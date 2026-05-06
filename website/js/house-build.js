const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const wrapper   = document.getElementById('house-scroll-wrapper');
const progressEl = document.getElementById('build-progress-fill');
const badgeEl    = document.getElementById('stage-badge');
const titleBlock = document.getElementById('svg-title-block');

if (!wrapper || prefersReduced) {
  // No animation — reveal everything
  document.querySelectorAll('.house-path').forEach(p => {
    p.style.strokeDasharray = 'none';
    p.style.strokeDashoffset = '0';
  });
  if (titleBlock) titleBlock.style.opacity = '1';
} else {
  const stages = [
    { el: null, paths: [], start: 0.00, end: 0.08, label: 'Surveying the lot…' },
    { el: null, paths: [], start: 0.08, end: 0.18, label: 'Laying the foundation…' },
    { el: null, paths: [], start: 0.18, end: 0.32, label: 'Framing the walls…' },
    { el: null, paths: [], start: 0.32, end: 0.46, label: 'Setting the roof…' },
    { el: null, paths: [], start: 0.46, end: 0.55, label: 'Building the chimney…' },
    { el: null, paths: [], start: 0.55, end: 0.70, label: 'Installing windows…' },
    { el: null, paths: [], start: 0.70, end: 0.82, label: 'Hanging the front door…' },
    { el: null, paths: [], start: 0.82, end: 0.90, label: 'Adding the steps…' },
    { el: null, paths: [], start: 0.90, end: 1.00, label: 'Finishing touches — complete.' },
  ];

  // Collect paths per stage
  document.querySelectorAll('.svg-stage').forEach((group, i) => {
    if (i < stages.length) {
      stages[i].el = group;
      stages[i].paths = Array.from(group.querySelectorAll('.house-path'));
    }
  });

  // Init dasharray = dashoffset = path length (invisible)
  stages.forEach(stage => {
    stage.paths.forEach(path => {
      let len;
      try { len = path.getTotalLength(); } catch { len = 200; }
      path.style.strokeDasharray  = len;
      path.style.strokeDashoffset = len;
      path._len = len;
    });
  });

  let lastLabel = '';

  function onScroll() {
    const rect    = wrapper.getBoundingClientRect();
    const total   = wrapper.offsetHeight - window.innerHeight;
    const scrolled = -rect.top;
    const progress = Math.max(0, Math.min(1, scrolled / total));

    // Progress bar
    if (progressEl) progressEl.style.width = (progress * 100) + '%';

    stages.forEach((stage, si) => {
      const { start, end, paths, label } = stage;

      if (progress < start) {
        // Not started — fully hidden
        paths.forEach(p => { p.style.strokeDashoffset = p._len; });
      } else if (progress >= end) {
        // Completed — fully visible
        paths.forEach(p => { p.style.strokeDashoffset = 0; });
        if (si === stages.length - 1 && titleBlock) {
          titleBlock.style.opacity = '1';
        }
      } else {
        // In progress — animate proportionally
        const stageProgress = (progress - start) / (end - start);
        paths.forEach(p => {
          p.style.strokeDashoffset = p._len * (1 - stageProgress);
        });

        // Update badge label
        if (label !== lastLabel) {
          lastLabel = label;
          if (badgeEl) badgeEl.textContent = label;
        }
      }
    });

    // Clear label when done
    if (progress >= 1 && badgeEl) {
      badgeEl.textContent = 'Construction complete.';
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll(); // Run once on load in case page starts scrolled
}
