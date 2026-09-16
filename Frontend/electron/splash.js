window.splash.onState(state => {
  const applying = state.status === 'installing';
  const downloading = state.status === 'downloading';
  const checking = state.status === 'checking';
  document.getElementById('status').textContent = applying ? 'Aplicando atualização…'
    : downloading ? 'Baixando atualização…'
    : checking ? 'Buscando atualizações…'
    : 'Carregando…';
  document.getElementById('detail').textContent = applying ? 'O aplicativo será reiniciado automaticamente.'
    : downloading ? 'Uma nova versão está chegando.'
    : 'Preparando seu espaço para compartilhar.';
  const percent = Number.isFinite(state.percent) ? Math.max(0, Math.min(100, state.percent)) : undefined;
  const bar = document.getElementById('bar');
  bar.classList.toggle('determinate', applying || percent !== undefined);
  bar.style.width = applying ? '100%' : percent !== undefined ? `${percent}%` : '';
});
