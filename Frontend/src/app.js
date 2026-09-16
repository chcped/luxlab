import { RoomClient, serverURL, invitation } from './room-client.mjs';
const $ = id => document.getElementById(id);
import { createPlayback } from './playback.mjs';
// Mantém contas e salas permanentes implementadas, mas fora da interface por enquanto.
const EMAIL_AUTH_UI_ENABLED = false;
const playback = createPlayback($('player'), {
  prompt: visible => { $('play').hidden = !visible; },
  report: error => {
    console.error('[playback]', error.name, error.message, $('player').error?.code);
    toast(error.name === 'NotSupportedError' ? 'O vídeo recebido não pôde ser carregado. Peça para reiniciar o compartilhamento.' : 'Falha ao reproduzir vídeo ou áudio. Confira a saída de áudio e tente novamente.', true);
  }
});
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
document.querySelectorAll('button:not([type])').forEach(button => { button.type = 'button'; });
const colors = ['#111111', '#3a3a3a', '#6a6a6a', '#9a9a9a', '#c8c8c8', '#f2f2f2'];
const avatars = ['initial', '🌙', '🎮', '🚀', '🐱', '🎧', '🌻'];
const saved = storage.get('luxlab.profile', {});
let profile = { name: String(saved.name || 'Visitante').slice(0, 32), color: colors.includes(saved.color) ? saved.color : colors[0], avatar: avatars.includes(saved.avatar) ? saved.avatar : 'initial' };
let base = location.protocol === 'app:' ? storage.get('luxlab.server', 'https://luxlab.net.br') : location.origin;
let client, session, members = [], localStream, watched, selectedSource, mode = 'create', captureGeneration = 0, captureBusy = false;
let serverConfig = {}, accessToken = '', account = null, savedRooms = [], activeSavedRoom = null, activeSavedInvite = null, managedRoom = null;
let pendingInvite = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
if (pendingInvite) history.replaceState(null, '', location.pathname + location.search);
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
$('settings-form').onsubmit = async event => { event.preventDefault(); try { base = serverURL($('server').value.trim()); storage.set('luxlab.server', base); await loadConfig(); $('settings-dialog').close(); toast('Servidor atualizado.'); } catch (e) { toast(e.message, true); } };
function setMode(value) { mode = value; $('create-tab').classList.toggle('active', mode === 'create'); $('join-tab').classList.toggle('active', mode === 'join'); $('create-fields').hidden = mode !== 'create'; $('invite-label').hidden = mode !== 'join'; $('invite').required = mode === 'join'; $('password-label').hidden = mode === 'create' && !$('locked').checked; $('password').required = mode === 'create' && $('locked').checked; $('password').minLength = mode === 'create' && $('locked').checked ? 4 : 0; $('enter').textContent = mode === 'create' ? '＋ Criar minha sala' : '↗ Entrar na sala'; }
$('create-tab').onclick = () => setMode('create'); $('join-tab').onclick = () => setMode('join'); $('locked').onchange = () => setMode(mode);
window.addEventListener('luxlab:auth', event => {
  if (!EMAIL_AUTH_UI_ENABLED) return;
  accessToken = typeof event.detail?.accessToken === 'string' ? event.detail.accessToken : '';
  loadAccount().catch(() => {});
});
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const response = await fetch(base + '/api/v2' + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000) });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) { if (response.status === 401 && auth) window.dispatchEvent(new CustomEvent('luxlab:login-required')); throw new Error(data.error || `Servidor retornou HTTP ${response.status}.`); }
  return data;
}
$('room-form').onsubmit = async event => {
  event.preventDefault(); $('enter').disabled = true;
  try {
    base = serverURL(base);
    const body = { profile, password: mode === 'create' && !$('locked').checked ? '' : $('password').value };
    const nextSession = await api(mode === 'create' ? '/rooms' : `/rooms/${invitation($('invite').value, base)}/join`, { method: 'POST', body });
    $('password').value = '';
    await enterSession(nextSession);
  } catch (error) { client?.close(); client = null; toast(error.message, true); }
  finally { $('enter').disabled = false; }
};
async function enterSession(nextSession, room = null) {
    session = nextSession; activeSavedRoom = room; activeSavedInvite = null;
    $('messages').replaceChildren(); addWelcome();
    client = new RoomClient(base, session, { joined(msg) { for (const message of msg.messages) addMessage(message); },
      members(msg) { members = msg.members; $('lock-status').textContent = activeSavedRoom ? '◇ Sala permanente' : msg.locked ? '♧ Com senha' : '◇ Por convite'; renderMembers(); selectAvailable(); },
      stream(id, stream) { remote.set(id, stream); if (watched === id) showStream(id); },
      removed(id) { remote.delete(id); connections.delete(id); },
      connection(id, state) { connections.set(id, state); updateConnection(); }, chat: addMessage,
      warning: text => toast(text, true), error(text) { leave(); toast(text, true); } });
    client.setHardwareAcceleration(storage.get('luxlab.hardwareAcceleration', true));
    await client.connect();
    $('home').hidden = true; $('room').hidden = false; $('room-code').textContent = session.roomId;
    $('copy-invite').hidden = room?.role === 'member'; $('copy-invite').textContent = room ? '↗ Copiar convite permanente' : '↗ Copiar convite';
    document.title = `Sala ${session.roomId} — Luxlab`; updateConnection();
    if (location.protocol !== 'app:' && location.origin === base) history.replaceState(null, '', `/room/${session.roomId}`);
    toast(room ? `Você entrou em ${room.name}.` : 'Você entrou na sala. Copie o convite para chamar sua galera.');
}
function addWelcome() { const box = document.createElement('div'); box.className = 'chat-welcome'; const title = document.createElement('strong'); title.textContent = 'Sua galera tem um lugar aqui ✨'; const p = document.createElement('p'); p.textContent = 'Compartilhe o convite e escolha uma tela para assistir. As mensagens ficam disponíveis enquanto a sala existir.'; box.append(title, p); $('messages').append(box); }
function addMessage(message) { const item = document.createElement('div'); item.className = 'chat-message'; const head = document.createElement('div'); head.className = 'message-head'; const icon = document.createElement('span'); icon.className = 'avatar'; avatar(icon, message.profile); const name = document.createElement('strong'); name.textContent = message.profile.name; const time = document.createElement('time'); time.textContent = new Date(message.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); const p = document.createElement('p'); p.textContent = message.text; head.append(icon, name, time); item.append(head, p); $('messages').append(item); while ($('messages').children.length > 101) $('messages').firstChild.remove(); $('messages').scrollTop = $('messages').scrollHeight; }
$('chat-form').onsubmit = event => { event.preventDefault(); const text = $('chat-input').value.trim(); if (text) { client?.send({ type: 'chat', text }); $('chat-input').value = ''; } };
function renderMembers() {
  $('member-count').textContent = members.length; $('members').replaceChildren();
  const sharing = members.filter(m => m.sharing).length; $('stream-count').textContent = sharing ? `${sharing} ${sharing === 1 ? 'transmissão ao vivo' : 'transmissões ao vivo'}` : 'Nenhuma transmissão';
  const owner = members.find(m => m.id === client?.self)?.owner;
  for (const member of [...members].sort((a, b) => Number(b.sharing) - Number(a.sharing))) {
    const row = document.createElement('div'); row.className = 'member'; row.classList.toggle('sharing', member.sharing); row.classList.toggle('watching', watched === member.id && member.sharing); row.tabIndex = 0; row.setAttribute('role', 'button'); row.setAttribute('aria-label', `Abrir áudio de ${member.profile.name}`); row.onclick = () => openParticipantAudio(member); row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openParticipantAudio(member); } };
    const icon = document.createElement('span'); icon.className = 'avatar'; avatar(icon, member.profile);
    const details = document.createElement('div'); details.className = 'member-details'; const name = document.createElement('span'); name.className = 'member-name'; name.textContent = `${member.owner ? '♛ ' : ''}${member.profile.name}${member.id === client?.self ? ' (você)' : ''}`;
    const status = document.createElement('small'); status.textContent = member.sharing ? '● Compartilhando tela' : '● Na sala'; details.append(name, status); row.append(icon, details);
    if (member.sharing) {
      const watch = document.createElement('button'); watch.textContent = watched === member.id ? 'ASSISTINDO' : 'VER TELA'; watch.onclick = event => { event.stopPropagation(); showStream(member.id); renderMembers(); }; row.append(watch);
    }
    if (owner && member.id !== client?.self) { const kick = document.createElement('button'); kick.className = 'kick'; kick.textContent = '×'; kick.title = `Remover ${member.profile.name}`; kick.setAttribute('aria-label', kick.title); kick.onclick = event => { event.stopPropagation(); client.send({ type: 'kick', to: member.id }); }; row.append(kick); }
    $('members').append(row);
  }
}
function openParticipantAudio(member) { $('participant-audio-name').textContent = member.profile.name; $('participant-audio-status').textContent = member.sharing ? 'O controle individual desta transmissão será ativado em breve.' : 'O controle individual do áudio deste participante será ativado em breve.'; $('participant-audio-dialog').showModal(); }
function selectAvailable() { if (!members.some(m => m.id === watched && m.sharing)) { const next = members.find(m => m.sharing && m.id !== client?.self) || members.find(m => m.sharing); showStream(next?.id); renderMembers(); } else { const member = members.find(m => m.id === watched); $('watching-label').textContent = watched === client?.self ? 'Sua tela · prévia sem retorno de áudio' : `Assistindo à tela de ${member.profile.name}`; } }
function showStream(id) {
  watched = id; const stream = id === client?.self ? localStream : remote.get(id);
  const member = members.find(m => m.id === id);
  $('empty-screen').hidden = !!id; $('live-label').hidden = !id; $('play').hidden = true;
  $('watching-label').textContent = id ? id === client?.self ? 'Sua tela · prévia sem retorno de áudio' : `Assistindo à tela de ${member?.profile.name || 'participante'}` : 'Sua sala está pronta';
  applyVolume(); playback.setStream(stream || null); updateConnection();
}
function updateConnection() { const state = connections.get(watched); $('connection').textContent = !client ? '● Desconectado' : !watched || watched === client.self ? '● Sala conectada' : state === 'connected' ? '● Transmissão conectada' : state === 'failed' || state === 'disconnected' ? '● Transmissão sem conexão' : '● Conectando transmissão'; }
let muted = false;
function applyVolume() { const value = Number($('volume').value); $('player').volume = value; $('player').muted = muted || watched === client?.self; $('mute').textContent = muted ? '♪ ×' : '♫'; $('volume-label').textContent = muted ? 'Som desativado' : `Volume ${Math.round(value * 100)}%`; }
$('volume').oninput = applyVolume; $('mute').onclick = () => { muted = !muted; applyVolume(); }; $('play').onclick = () => playback.play();
$('fullscreen').onclick = () => { const action = document.fullscreenElement ? document.exitFullscreen() : $('screen').requestFullscreen(); action.catch(() => toast('Tela cheia indisponível.', true)); };
$('copy-invite').onclick = async () => {
  if (!session?.roomId) return;
  if (activeSavedRoom?.role === 'owner' && !activeSavedInvite) {
    try { activeSavedInvite = (await api(`/saved-rooms/${activeSavedRoom.id}/invite`)).invite; } catch (error) { toast(error.message, true); return; }
  }
  const link = activeSavedRoom ? activeSavedInvite?.enabled ? `${base}/#invite=${encodeURIComponent(activeSavedInvite.code)}` : '' : `${base}/room/${session.roomId}`;
  if (!link) { toast('O convite desta sala está desativado.', true); return; }
  try {
    if (window.desktop?.copyText) await window.desktop.copyText(link);
    else await navigator.clipboard.writeText(link);
    toast('Convite copiado! Envie o link para sua galera.');
  } catch { toast(`Não foi possível copiar o convite. Link: ${link}`, true); }
};
$('hardware-acceleration').checked = storage.get('luxlab.hardwareAcceleration', true);
$('hardware-acceleration').onchange = () => {
  const enabled = $('hardware-acceleration').checked;
  storage.set('luxlab.hardwareAcceleration', enabled);
  client?.setHardwareAcceleration(enabled);
};
async function openCapture() {
  if (localStream) { await stopSharing(); return; }
  selectedSource = null; $('sources').replaceChildren(); $('confirm-share').disabled = !!window.desktop;
  $('hardware-acceleration').checked = storage.get('luxlab.hardwareAcceleration', true);
  $('capture-dialog').showModal();
  $('audio-share-option').hidden = !!window.desktop;
  if (!window.desktop) { $('capture-help').textContent = 'Para transmitir som, escolha uma aba e compartilhe o áudio dela. Tela e janela serão compartilhadas sem áudio geral do PC.'; return; }
  try { const sources = await window.desktop.getSources(); for (const source of sources) { const button = document.createElement('button'); button.className = 'source'; const img = document.createElement('img'); img.src = source.thumbnail; img.alt = ''; const title = document.createElement('span'); title.textContent = source.name; button.append(img, title); button.onclick = () => { selectedSource = source.id; for (const b of $('sources').children) b.classList.toggle('selected', b === button); $('confirm-share').disabled = false; }; $('sources').append(button); } if (!sources.length) toast('Nenhuma tela ou janela encontrada.', true); } catch { toast('Não foi possível listar as telas.', true); }
}
$('share').onclick = $('empty-share').onclick = () => openCapture().catch(e => toast(e.message, true));
$('confirm-share').onclick = async () => {
  if (captureBusy || !client) return; captureBusy = true;
  const run = ++captureGeneration; const current = client; $('confirm-share').disabled = true;
  let captured;
  try {
    storage.set('luxlab.hardwareAcceleration', $('hardware-acceleration').checked);
    current.setHardwareAcceleration($('hardware-acceleration').checked);
    if (window.desktop) await window.desktop.selectSource(selectedSource);
    captured = await navigator.mediaDevices.getDisplayMedia({ video: { height: { ideal: Number($('quality').value) }, frameRate: { ideal: 30, max: 30 } }, audio: window.desktop || $('system-audio').checked ? { restrictOwnAudio: true, suppressLocalAudioPlayback: false } : false, systemAudio: 'exclude', windowAudio: 'exclude' });
    // Some browsers ignore the hints. Only accept browser-tab audio.
    if (!window.desktop && captured.getVideoTracks()[0]?.getSettings().displaySurface !== 'browser') {
      for (const track of captured.getAudioTracks()) { captured.removeTrack(track); track.stop(); }
    }
    if (run !== captureGeneration || current !== client || client.closed) { captured.getTracks().forEach(t => t.stop()); return; }
    localStream = captured; captured.getVideoTracks()[0].onended = () => { stopSharing().catch(() => {}); };
    await current.setStream(captured);
    if (run !== captureGeneration || current !== client || current.closed) { captured.getTracks().forEach(t => t.stop()); return; }
    $('capture-dialog').close(); $('share').textContent = '■ Parar compartilhamento'; $('share').classList.add('danger');
    $('capture-status').textContent = captured.getAudioTracks().length ? '● Você está compartilhando tela e áudio do aplicativo ou aba selecionada.' : '● Você está compartilhando a tela, sem áudio.';
    if (!window.desktop && $('system-audio').checked && !captured.getAudioTracks().length) toast('Compartilhando sem áudio. No navegador, selecione uma aba com som.');
    if (!watched) { showStream(client.self); renderMembers(); }
  } catch (e) { captured?.getTracks().forEach(t => t.stop()); localStream = null; await current.setStream(null).catch(() => {}); toast(e.name === 'NotAllowedError' ? 'Compartilhamento cancelado ou não autorizado.' : e.message, true); }
  finally { captureBusy = false; $('confirm-share').disabled = false; }
};
async function stopSharing() { captureGeneration++; const stream = localStream; localStream = null; stream?.getTracks().forEach(t => t.stop()); await client?.setStream(null).catch(() => {}); $('share').textContent = '▣ Compartilhar tela'; $('share').classList.remove('danger'); $('capture-status').textContent = 'Sua tela não está sendo compartilhada.'; if (watched === client?.self) showStream(); }
function leave() { captureGeneration++; localStream?.getTracks().forEach(t => t.stop()); localStream = null; client?.close(); client = null; session = null; activeSavedRoom = null; activeSavedInvite = null; members = []; remote.clear(); connections.clear(); showStream(); $('room').hidden = true; $('home').hidden = false; $('copy-invite').hidden = false; $('share').textContent = '▣ Compartilhar tela'; $('share').classList.remove('danger'); $('capture-status').textContent = 'Sua tela não está sendo compartilhada.'; for (const d of document.querySelectorAll('dialog[open]')) d.close(); document.title = 'Luxlab — Sua sala, sua companhia'; if (location.protocol !== 'app:') history.replaceState(null, '', '/'); }
$('leave').onclick = leave; window.addEventListener('beforeunload', leave);
document.querySelector('.room-brand').onclick = event => { event.preventDefault(); leave(); };
async function outputs() { const selected = $('speakers').value; $('speakers').replaceChildren(new Option('Padrão do sistema', '')); const devices = await navigator.mediaDevices.enumerateDevices(); for (const device of devices.filter(d => d.kind === 'audiooutput' && d.deviceId && d.deviceId !== 'default')) $('speakers').append(new Option(device.label || 'Saída de áudio', device.deviceId)); if ([...$('speakers').options].some(o => o.value === selected)) $('speakers').value = selected; }
$('audio-settings').onclick = async () => { $('audio-dialog').showModal(); $('speakers').disabled = !('setSinkId' in $('player')); $('choose-speaker').hidden = !navigator.mediaDevices.selectAudioOutput; try { await outputs(); } catch { toast('Não foi possível listar as saídas de áudio.', true); } };
$('speakers').onchange = async () => { try { await $('player').setSinkId($('speakers').value); toast('Saída de áudio atualizada.'); } catch { $('speakers').value = ''; toast('Essa saída não está disponível. Use a saída padrão do sistema.', true); } };
$('choose-speaker').onclick = async () => { try { const device = await navigator.mediaDevices.selectAudioOutput(); await $('player').setSinkId(device.deviceId); await outputs(); $('speakers').value = device.deviceId; } catch { toast('Seleção de saída cancelada ou indisponível.'); } };
function openLogin() { $('email-form').hidden = false; $('code-form').hidden = true; $('login-code').value = ''; $('login-dialog').showModal(); }
$('account-open').onclick = () => account ? loadRooms().catch(error => toast(error.message, true)) : openLogin();
$('change-email').onclick = () => { $('email-form').hidden = false; $('code-form').hidden = true; };
$('email-form').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try { await api('/auth/email/request', { method: 'POST', body: { email: $('login-email').value }, auth: false }); $('email-form').hidden = true; $('code-form').hidden = false; $('code-help').textContent = `Digite o código enviado para ${$('login-email').value.trim()}.`; $('login-code').focus(); }
  catch (error) { toast(error.message, true); } finally { button.disabled = false; }
};
$('code-form').onsubmit = async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    const result = await api('/auth/email/verify', { method: 'POST', body: { email: $('login-email').value, code: $('login-code').value }, auth: false });
    accessToken = result.accessToken; account = result.account;
    if (window.desktop?.setAccountSession) await window.desktop.setAccountSession({ accessToken, expiresAt: result.expiresAt, base });
    $('login-dialog').close(); await afterLogin(); toast('Conta conectada.');
  } catch (error) { toast(error.message, true); } finally { button.disabled = false; }
};
async function clearAccount() { accessToken = ''; account = null; savedRooms = []; managedRoom = null; if (window.desktop?.clearAccountSession) await window.desktop.clearAccountSession().catch(() => {}); renderAccount(); }
$('logout').onclick = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch {} await clearAccount(); toast('Você saiu da conta.'); };
function renderAccount() {
  const available = !!(EMAIL_AUTH_UI_ENABLED && serverConfig.emailLogin && serverConfig.persistentRooms);
  $('account-open').hidden = !available; $('account-open').textContent = account ? account.email : 'Entrar';
  $('account-area').hidden = !available || !account; $('account-email').textContent = account?.email || '';
  $('room-form').hidden = serverConfig.allowGuests === false;
  $('create-tab').hidden = serverConfig.allowGuests === false; $('join-tab').hidden = serverConfig.allowGuests === false;
  renderSavedRooms();
}
function renderSavedRooms() {
  $('saved-rooms').replaceChildren();
  if (!savedRooms.length) { const empty = document.createElement('small'); empty.textContent = 'Você ainda não tem salas permanentes.'; $('saved-rooms').append(empty); return; }
  for (const room of savedRooms) {
    const row = document.createElement('div'); row.className = 'saved-room';
    const info = document.createElement('div'); info.className = 'saved-room-info'; const name = document.createElement('strong'); name.textContent = room.name; const role = document.createElement('small'); role.textContent = room.role === 'owner' ? 'Você é o dono' : 'Você é membro'; info.append(name, role);
    const enter = document.createElement('button'); enter.className = 'primary'; enter.textContent = 'Entrar'; enter.onclick = () => joinSavedRoom(room);
    const manage = document.createElement('button'); manage.textContent = '•••'; manage.title = 'Gerenciar sala'; manage.onclick = () => openRoomManager(room);
    row.append(info, enter, manage); $('saved-rooms').append(row);
  }
}
async function loadRooms() { savedRooms = (await api('/saved-rooms')).rooms; renderAccount(); }
async function afterLogin() { renderAccount(); if (pendingInvite) { const code = pendingInvite; pendingInvite = ''; const { room } = await api('/invites/accept', { method: 'POST', body: { code } }); toast(`Convite aceito: ${room.name}.`); } await loadRooms(); }
async function loadAccount() {
  if (!accessToken) return renderAccount();
  try { const result = await api('/auth/me'); account = result.account; await afterLogin(); } catch { await clearAccount(); if (pendingInvite) openLogin(); }
}
async function loadConfig() {
  serverConfig = await api('/config', { auth: false }); renderAccount();
  if (EMAIL_AUTH_UI_ENABLED && serverConfig.emailLogin && serverConfig.persistentRooms) {
    const stored = window.desktop?.getAccountSession ? await window.desktop.getAccountSession().catch(() => null) : null;
    if (!accessToken && stored?.base === base && stored.expiresAt > Date.now()) accessToken = stored.accessToken;
    await loadAccount(); if (pendingInvite && !account) openLogin();
  }
}
$('saved-room-form').onsubmit = async event => { event.preventDefault(); const button = event.submitter; button.disabled = true; try { const result = await api('/saved-rooms', { method: 'POST', body: { name: $('saved-room-name').value.trim(), inviteEnabled: true } }); $('saved-room-name').value = ''; await loadRooms(); await joinSavedRoom(result.room); activeSavedInvite = result.invite; } catch (error) { toast(error.message, true); } finally { button.disabled = false; } };
async function joinSavedRoom(room) { try { const nextSession = await api(`/saved-rooms/${room.id}/join`, { method: 'POST', body: { profile } }); await enterSession(nextSession, room); } catch (error) { toast(error.message, true); } }
async function openRoomManager(room) {
  managedRoom = room; $('manage-room-name').textContent = room.name; $('rename-room-name').value = room.name;
  const owner = room.role === 'owner'; $('owner-tools').hidden = !owner; $('delete-saved-room').hidden = !owner; $('leave-saved-room').hidden = owner;
  $('manage-room-dialog').showModal(); if (owner) await refreshRoomManager().catch(error => toast(error.message, true));
}
async function refreshRoomManager() {
  const [{ members: authorized }, { invite }] = await Promise.all([api(`/saved-rooms/${managedRoom.id}/members`), api(`/saved-rooms/${managedRoom.id}/invite`)]); activeSavedInvite = invite;
  $('authorized-members').replaceChildren();
  for (const member of authorized) { const row = document.createElement('div'); row.className = 'authorized-member'; const email = document.createElement('span'); email.textContent = member.email; row.append(email); if (member.id !== managedRoom.ownerId) { const remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = 'Remover'; remove.onclick = async () => { try { await api(`/saved-rooms/${managedRoom.id}/members/${member.id}`, { method: 'DELETE' }); await refreshRoomManager(); } catch (error) { toast(error.message, true); } }; row.append(remove); } $('authorized-members').append(row); }
  $('copy-saved-invite').disabled = !invite.enabled; $('disable-invite').disabled = !invite.enabled;
}
$('rename-room-form').onsubmit = async event => { event.preventDefault(); try { const { room } = await api(`/saved-rooms/${managedRoom.id}`, { method: 'PATCH', body: { name: $('rename-room-name').value.trim() } }); managedRoom = room; $('manage-room-name').textContent = room.name; await loadRooms(); } catch (error) { toast(error.message, true); } };
$('add-member-form').onsubmit = async event => { event.preventDefault(); try { await api(`/saved-rooms/${managedRoom.id}/members`, { method: 'POST', body: { email: $('member-email').value } }); $('member-email').value = ''; await refreshRoomManager(); } catch (error) { toast(error.message, true); } };
async function setInvite(enabled) { try { activeSavedInvite = (await api(`/saved-rooms/${managedRoom.id}/invite`, { method: 'POST', body: { enabled } })).invite; await refreshRoomManager(); toast(enabled ? 'Novo convite gerado.' : 'Convite desativado.'); } catch (error) { toast(error.message, true); } }
$('rotate-invite').onclick = () => setInvite(true); $('disable-invite').onclick = () => setInvite(false);
$('copy-saved-invite').onclick = async () => { if (!activeSavedInvite?.enabled) return; const link = `${base}/#invite=${encodeURIComponent(activeSavedInvite.code)}`; try { if (window.desktop?.copyText) await window.desktop.copyText(link); else await navigator.clipboard.writeText(link); toast('Convite permanente copiado.'); } catch { toast(`Não foi possível copiar. Link: ${link}`, true); } };
$('leave-saved-room').onclick = async () => { try { await api(`/saved-rooms/${managedRoom.id}/leave`, { method: 'POST' }); $('manage-room-dialog').close(); await loadRooms(); } catch (error) { toast(error.message, true); } };
$('delete-saved-room').onclick = async () => { if (!confirm(`Excluir permanentemente “${managedRoom.name}”?`)) return; try { await api(`/saved-rooms/${managedRoom.id}`, { method: 'DELETE' }); $('manage-room-dialog').close(); await loadRooms(); } catch (error) { toast(error.message, true); } };
updateProfile(); applyVolume(); renderAccount();
const initialInvite = location.pathname.match(/^\/room\/([A-Za-z0-9_-]{12})\/?$/)?.[1]; if (initialInvite) { setMode('join'); $('invite').value = initialInvite; }
loadConfig().catch(() => { serverConfig = { allowGuests: true }; renderAccount(); if (pendingInvite) toast('O servidor não anunciou suporte a contas e convites permanentes.', true); }).finally(() => { const boot = $('boot'); if (boot) boot.hidden = true; });
