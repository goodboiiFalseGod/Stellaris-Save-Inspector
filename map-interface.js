'use strict';

(() => {
  const panel = document.querySelector('.galaxy-map-panel');
  const topButton = document.querySelector('#map-top-toggle');
  const detailButton = document.querySelector('#map-detail-toggle');
  const expandButton = document.querySelector('#map-detail-expand');
  const fullscreenButton = document.querySelector('#map-fullscreen');
  const resize = () => requestAnimationFrame(() => GalaxyMap.resize());
  if (typeof ResizeObserver !== 'undefined') {
    const legend = document.querySelector('.map-legend');
    new ResizeObserver(() => {
      panel.style.setProperty('--route-dock-bottom', `${legend.offsetHeight + 20}px`);
    }).observe(legend);
  }
  topButton.addEventListener('click', () => {
    const hidden = document.body.classList.toggle('map-top-hidden');
    topButton.textContent = hidden ? 'Show top menu' : 'Hide top menu';
    topButton.setAttribute('aria-expanded', String(!hidden));
    resize();
  });
  detailButton.addEventListener('click', () => {
    GalaxyMap.closeSystemPanel();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.system-panel, #galaxy-map, [data-route-system]')) GalaxyMap.closeSystemPanel();
  });
  expandButton.addEventListener('click', () => {
    const expanded = panel.classList.toggle('system-panel-expanded');
    expandButton.textContent = expanded ? 'Compact system panel' : 'Expand system panel';
    expandButton.setAttribute('aria-pressed', String(expanded));
    resize();
  });
  fullscreenButton.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === panel) await document.exitFullscreen();
      else await panel.requestFullscreen();
    } catch (error) {
      console.warn('Не удалось включить полноэкранный режим карты:', error);
      document.querySelector('#status').textContent = `Fullscreen unavailable: ${error.message}`;
      fullscreenButton.title = `Fullscreen unavailable: ${error.message}`;
    }
  });
  document.addEventListener('fullscreenchange', () => {
    const active = document.fullscreenElement === panel;
    fullscreenButton.textContent = active ? 'Exit fullscreen' : 'Fullscreen';
    fullscreenButton.setAttribute('aria-pressed', String(active));
    resize();
  });
})();
