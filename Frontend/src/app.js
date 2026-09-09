import { RoomClient, serverURL, invitation } from './room-client.mjs';
const $ = id => document.getElementById(id);
if (window.desktop?.onUpdateState) {
  let dismissedVersion;
  const renderUpdate = state => {
    $('update-banner').hidden = state.status !== 'downloaded' || state.version === dismissedVersion;
    if (state.status === 'downloaded') $('update-message').textContent = `Versão ${state.version} pronta para instalar.`;
    $('update-restart').disabled = false;
    $('update-later').onclick = () => { dismissedVersion = state.version; $('update-banner').hidden = true; };
  };
  window.desktop.onUpdateState(renderUpdate);
  window.desktop.getUpdateState().then(renderUpdate).catch(() => {});
  $('update-restart').onclick = async () => {
    $('update-restart').disabled = true;
    try {
      if (!await window.desktop.installUpdate()) throw new Error('Atualização indisponível.');
    } catch {
      $('update-restart').disabled = false;
      toast('Não foi possível instalar a atualização. Tente novamente.', true);
    }
  };
}
const storage = { get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} } };
const colors = ['#7c6cff', '#ec4899', '#14b8a6', '#f59e0b', '#3b82f6', '#ef4444'];
const avatars = ['initial', '🌙', '🎮', '🚀', '🐱', '🎧', '🌻'];
const saved = storage.get('luxlab.profile', {});
let profile = { name: String(saved.name || 'Visitante').slice(0, 32), color: colors.includes(saved.color) ? saved.color : colors[0], avatar: avatars.includes(saved.avatar) ? saved.avatar : 'initial' };
let base = location.protocol === 'app:' ? storage.get('luxlab.server', 'https://luxlab.net.br') : location.origin;
let client, session, members = [], localStream, watched, selectedSource, mode = 'create', captureGeneration = 0, captureBusy = false;
const remote = new Map(), connections = new Map();
let toastTimer;
function toast(text, error = false) { $('toast').textContent = text; $('toast').classList.toggle('error', error); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 4500); }
function avatar(element, data) { element.style.backgroundColor = data.color; element.textContent = data.avatar === 'initial' ? data.name.slice(0, 1).toUpperCase() : data.avatar; }
function updateProfile() { avatar($('home-avatar'), profile); $('home-name').textContent = profile.name; }
function openProfile() { $('profile-name').value = profile.name; $('profile-color').value = profile.color; $('profile-avatar').value = profile.avatar; previewProfile(); $('profile-dialog').showModal(); }
function previewProfile() { avatar($('profile-preview'), { name: $('profile-name').value || '?', color: $('profile-color').value, avatar: $('profile-avatar').value }); }
$('profile-open').onclick = $('room-profile').onclick = openProfile;
for (const id of ['profile-name', 'profile-color', 'profile-avatar']) $(id).oninput = previewProfile;
$('profile-form').onsubmit = event => { event.preventDefault(); profile = { name: $('profile-name').value.trim() || 'Visitante', color: $('profile-color').value, avatar: $('profile-avatar').value }; storage.set('luxlab.profile', profile); updateProfile(); client?.send({ type: 'profile', profile }); $('profile-dialog').close(); toast('Perfil atualizado.'); };
for (const button of document.querySelectorAll('.close-dialog')) button.onclick = () => button.closest('dialog').close();
$('settings-open').onclick = () => { $('server').value = base; $('settings-dialog').showModal(); };
$('settings-form').onsubmit = event => { event.preventDefault(); try { base = serverURL($('server').value.trim()); storage.set('luxlab.server', base); $('settings-dialog').close(); toast('Servidor atualizado.'); } catch (e) { toast(e.message, true); } };
function setMode(value) { mode = value; $('create-tab').classList.toggle('active', mode === 'create'); $('join-tab').classList.toggle('active', mode === 'join'); $('create-fields').hidden = mode !== 'create'; $('invite-label').hidden = mode !== 'join'; $('invite').required = mode === 'join'; $('password-label').hidden = mode === 'create' && !$('locked').checked; $('password').required = mode === 'create' && $('locked').checked; $('password').minLength = mode === 'create' && $('locked').checked ? 4 : 0; $('enter').textContent = mode === 'create' ? '＋ Criar minha sala' : '↗ Entrar na sala'; }
$('create-tab').onclick = () => setMode('create'); $('join-tab').onclick = () => setMode('join'); $('locked').onchange = () => setMode(mode);
// Login integration: your provider sets a short-lived access token in memory by
// dispatching CustomEvent('luxlab:auth', { detail: { accessToken } }). Never store secrets here.
let accessToken = '';
window.addEventListener('luxlab:auth', event => { accessToken = typeof event.detail?.accessToken === 'string' ? event.detail.accessToken : ''; });
async function api(path, body) { const response = await fetch(base + '/api/v2' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(12000) }); const data = await response.json().catch(() => ({})); if (!response.ok) { if (response.status === 401) window.dispatchEvent(new CustomEvent('luxlab:login-required')); throw new Error(data.error || `Servidor retornou HTTP ${response.status}.`); } return data; }
$('room-form').onsubmit = async event => {
  event.preventDefault(); $('enter').disabled = true;
  try {
    base = serverURL(base);
    const body = { profile, password: mode === 'create' && !$('locked').checked ? '' : $('password').value };
    session = await api(mode === 'create' ? '/rooms' : `/rooms/${invitation($('invite').value, base)}/join`, body);
    $('password').value = '';
    $('messages').replaceChildren(); addWelcome();
    client = new RoomClient(base, session, { joined(msg) { for (const message of msg.messages) addMessage(message); },
      members(msg) { members = msg.members; $('lock-status').textContent = msg.locked ? '♧ Com senha' : '◇ Por convite'; renderMembers(); selectAvailable(); },
      stream(id, stream) { remote.set(id, stream); if (watched === id) showStream(id); },
      removed(id) { remote.delete(id); connections.delete(id); },
      connection(id, state) { connections.set(id, state); updateConnection(); }, chat: addMessage,
      warning: text => toast(text, true), error(text) { leave(); toast(text, true); } });
    await client.connect();
    $('home').hidden = true; $('room').hidden = false; $('room-code').textContent = session.roomId;
    document.title = `Sala ${session.roomId} — Luxlab`; updateConnection();
    if (location.protocol !== 'app:' && location.origin === base) history.replaceState(null, '', `/room/${session.roomId}`);
    toast('Você entrou na sala. Copie o convite para chamar sua galera.');
  } catch (error) { client?.close(); client = null; toast(error.message, true); }
  finally { $('enter').disabled = false; }
};
function addWelcome() { const box = document.createElement('div'); box.className = 'chat-welcome'; const title = document.createElement('strong'); title.textContent = 'Sua galera tem um lugar aqui ✨'; const p = document.createElement('p'); p.textContent = 'Compartilhe o convite e escolha uma tela para assistir. As mensagens ficam disponíveis enquanto a sala existir.'; box.append(title, p); $('messages').append(box); }
function addMessage(message) { const item = document.createElement('div'); item.className = 'chat-message'; const head = document.createElement('div'); head.className = 'message-head'; const icon = document.createElement('span'); icon.className = 'avatar'; avatar(icon, message.profile); const name = document.createElement('strong'); name.textContent = message.profile.name; const time = document.createElement('time'); time.textContent = new Date(message.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); const p = document.createElement('p'); p.textContent = message.text; head.append(icon, name, time); item.append(head, p); $('messages').append(item); while ($('messages').children.length > 101) $('messages').firstChild.remove(); $('messages').scrollTop = $('messages').scrollHeight; }
$('chat-form').onsubmit = event => { event.preventDefault(); const text = $('chat-input').value.trim(); if (text) { client?.send({ type: 'chat', text }); $('chat-input').value = ''; } };
function renderMembers() {
  $('member-count').textContent = members.length; $('members').replaceChildren();
  const sharing = members.filter(m => m.sharing).length; $('stream-count').textContent = sharing ? `${sharing} ${sharing === 1 ? 'transmissão ao vivo' : 'transmissões ao vivo'}` : 'Nenhuma transmissão';
  const owner = members.find(m => m.id === client?.self)?.owner;
  for (const member of [...members].sort((a, b) => Number(b.sharing) - Number(a.sharing))) {
    const row = document.createElement('div'); row.className = 'member'; row.classList.toggle('sharing', member.sharing); row.classList.toggle('watching', watched === member.id && member.sharing);
    const icon = document.createElement('span'); icon.className = 'avatar'; avatar(icon, member.profile);
    const details = document.createElement('div'); details.className = 'member-details'; const name = document.createElement('span'); name.className = 'member-name'; name.textContent = `${member.owner ? '♛ ' : ''}${member.profile.name}${member.id === client?.self ? ' (você)' : ''}`;
    const status = document.createElement('small'); status.textContent = member.sharing ? '● Compartilhando tela' : '● Na sala'; details.append(name, status); row.append(icon, details);
    if (member.sharing) { const watch = document.createElement('button'); watch.textContent = watched === member.id ? 'ASSISTINDO' : 'VER TELA'; watch.onclick = () => { showStream(member.id); renderMembers(); }; row.append(watch); }
    if (owner && member.id !== client?.self) { const kick = document.createElement('button'); kick.className = 'kick'; kick.textContent = '×'; kick.title = `Remover ${member.profile.name}`; kick.setAttribute('aria-label', kick.title); kick.onclick = () => client.send({ type: 'kick', to: member.id }); row.append(kick); }
    $('members').append(row);
  }
}
function selectAvailable() { if (!members.some(m => m.id === watched && m.sharing)) { const next = members.find(m => m.sharing && m.id !== client?.self) || members.find(m => m.sharing); showStream(next?.id); renderMembers(); } else { const member = members.find(m => m.id === watched); $('watching-label').textContent = watched === client?.self ? 'Sua tela · prévia sem retorno de áudio' : `Assistindo à tela de ${member.profile.name}`; } }
function showStream(id) {
  watched = id; const stream = id === client?.self ? localStream : remote.get(id); const player = $('player'); player.srcObject = stream || null;
  const member = members.find(m => m.id === id);
  $('empty-screen').hidden = !!id; $('live-label').hidden = !id; $('play').hidden = true;
  $('watching-label').textContent = id ? id === client?.self ? 'Sua tela · prévia sem retorno de áudio' : `Assistindo à tela de ${member?.profile.name || 'participante'}` : 'Sua sala está pronta';
  applyVolume(); if (stream) player.play().catch(() => { if (player.srcObject === stream) $('play').hidden = false; }); updateConnection();
}
function updateConnection() { const state = connections.get(watched); $('connection').textContent = !client ? '● Desconectado' : !watched || watched === client.self ? '● Sala conectada' : state === 'connected' ? '● Transmissão conectada' : state === 'failed' || state === 'disconnected' ? '● Transmissão sem conexão' : '● Conectando transmissão'; }
let muted = false;
function applyVolume() { $('player').volume = Number($('volume').value); $('player').muted = muted || watched === client?.self; $('mute').textContent = muted ? '♪ ×' : '♫'; $('volume-label').textContent = muted ? 'Som desativado' : `Volume ${Math.round(Number($('volume').value) * 100)}%`; }
$('volume').oninput = applyVolume; $('mute').onclick = () => { muted = !muted; applyVolume(); }; $('play').onclick = () => $('player').play().then(() => { $('play').hidden = true; }).catch(() => toast('Não foi possível reproduzir a transmissão.', true));
$('fullscreen').onclick = () => { const action = document.fullscreenElement ? document.exitFullscreen() : $('screen').requestFullscreen(); action.catch(() => toast('Tela cheia indisponível.', true)); };
$('copy-invite').onclick = async () => {
  if (!session?.roomId) return;
  const link = `${base}/room/${session.roomId}`;
  try {
    if (window.desktop?.copyText) await window.desktop.copyText(link);
    else await navigator.clipboard.writeText(link);
    toast('Convite copiado! Envie o link para sua galera.');
  } catch { toast(`Não foi possível copiar o convite. Link: ${link}`, true); }
};
async function openCapture() {
  if (localStream) { await stopSharing(); return; }
  selectedSource = null; $('sources').replaceChildren(); $('confirm-share').disabled = !!window.desktop;
  $('capture-dialog').showModal();
  if (!window.desktop) { $('capture-help').textContent = 'O navegador vai pedir que você escolha uma tela, janela ou aba. Para áudio, marque a opção de compartilhar som no seletor.'; return; }
  try { const sources = await window.desktop.getSources(); for (const source of sources) { const button = document.createElement('button'); button.className = 'source'; const img = document.createElement('img'); img.src = source.thumbnail; img.alt = ''; const title = document.createElement('span'); title.textContent = source.name; button.append(img, title); button.onclick = () => { selectedSource = source.id; for (const b of $('sources').children) b.classList.toggle('selected', b === button); $('confirm-share').disabled = false; }; $('sources').append(button); } if (!sources.length) toast('Nenhuma tela ou janela encontrada.', true); } catch { toast('Não foi possível listar as telas.', true); }
}
$('share').onclick = $('empty-share').onclick = () => openCapture().catch(e => toast(e.message, true));
$('confirm-share').onclick = async () => {
  if (captureBusy || !client) return; captureBusy = true;
  const run = ++captureGeneration; const current = client; $('confirm-share').disabled = true;
  let captured;
  try {
    if (window.desktop) await window.desktop.selectSource(selectedSource);
    captured = await navigator.mediaDevices.getDisplayMedia({ video: { height: { ideal: Number($('quality').value) }, frameRate: { ideal: 30, max: 30 } }, audio: $('system-audio').checked ? { restrictOwnAudio: true, suppressLocalAudioPlayback: false } : false });
    if (run !== captureGeneration || current !== client || client.closed) { captured.getTracks().forEach(t => t.stop()); return; }
    localStream = captured; captured.getVideoTracks()[0].onended = () => { stopSharing().catch(() => {}); };
    await current.setStream(captured);
    if (run !== captureGeneration || current !== client || current.closed) { captured.getTracks().forEach(t => t.stop()); return; }
    $('capture-dialog').close(); $('share').textContent = '■ Parar compartilhamento'; $('share').classList.add('danger');
    $('capture-status').textContent = captured.getAudioTracks().length ? '● Você está compartilhando tela e áudio do sistema.' : '● Você está compartilhando a tela, sem áudio.';
    if ($('system-audio').checked && !captured.getAudioTracks().length) toast('A fonte selecionada não forneceu áudio. Tente compartilhar uma aba com som ou usar o aplicativo desktop.');
    if (!watched) { showStream(client.self); renderMembers(); }
  } catch (e) { captured?.getTracks().forEach(t => t.stop()); localStream = null; await current.setStream(null).catch(() => {}); toast(e.name === 'NotAllowedError' ? 'Compartilhamento cancelado ou não autorizado.' : e.message, true); }
  finally { captureBusy = false; $('confirm-share').disabled = false; }
};
async function stopSharing() { captureGeneration++; const stream = localStream; localStream = null; stream?.getTracks().forEach(t => t.stop()); await client?.setStream(null).catch(() => {}); $('share').textContent = '▣ Compartilhar tela'; $('share').classList.remove('danger'); $('capture-status').textContent = 'Sua tela não está sendo compartilhada.'; if (watched === client?.self) showStream(); }
function leave() { captureGeneration++; localStream?.getTracks().forEach(t => t.stop()); localStream = null; client?.close(); client = null; session = null; members = []; remote.clear(); connections.clear(); showStream(); $('room').hidden = true; $('home').hidden = false; $('share').textContent = '▣ Compartilhar tela'; $('share').classList.remove('danger'); $('capture-status').textContent = 'Sua tela não está sendo compartilhada.'; for (const d of document.querySelectorAll('dialog[open]')) d.close(); document.title = 'Luxlab — Sua sala, sua companhia'; if (location.protocol !== 'app:') history.replaceState(null, '', '/'); }
$('leave').onclick = leave; window.addEventListener('beforeunload', leave);
document.querySelector('.room-brand').onclick = event => { event.preventDefault(); leave(); };
async function outputs() { const selected = $('speakers').value; $('speakers').replaceChildren(new Option('Padrão do sistema', '')); const devices = await navigator.mediaDevices.enumerateDevices(); for (const device of devices.filter(d => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default')) $('speakers').append(new Option(device.label || 'Saída de áudio', device.deviceId)); if ([...$('speakers').options].some(o => o.value === selected)) $('speakers').value = selected; }
$('audio-settings').onclick = async () => { $('audio-dialog').showModal(); $('speakers').disabled = !('setSinkId' in $('player')); $('choose-speaker').hidden = !navigator.mediaDevices.selectAudioOutput; try { await outputs(); } catch { toast('Não foi possível listar as saídas de áudio.', true); } };
$('speakers').onchange = async () => { try { await $('player').setSinkId($('speakers').value); toast('Saída de áudio atualizada.'); } catch { $('speakers').value = ''; toast('Essa saída não está disponível. Use a saída padrão do sistema.', true); } };
$('choose-speaker').onclick = async () => { try { const device = await navigator.mediaDevices.selectAudioOutput(); await $('player').setSinkId(device.deviceId); await outputs(); $('speakers').value = device.deviceId; } catch { toast('Seleção de saída cancelada ou indisponível.'); } };
updateProfile(); applyVolume();
const initialInvite = location.pathname.match(/^\/room\/([A-Za-z0-9_-]{12})\/?$/)?.[1]; if (initialInvite) { setMode('join'); $('invite').value = initialInvite; }
