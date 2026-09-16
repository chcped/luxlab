import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, KeyboardAvoidingView, Modal, NativeModules, PanResponder, Platform, ScrollView, Share, StatusBar, StyleSheet, Text as RNText, TextInput as RNTextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import type { TextInputProps, TextProps } from 'react-native';
import { FONT_DISPLAY, FONT_UI } from './src/fonts';

function Text({ display, style, ...props }: TextProps & { display?: boolean }) {
  return <RNText {...props} style={[{ fontFamily: display ? FONT_DISPLAY : FONT_UI }, style]} />;
}
function TextInput(props: TextInputProps) {
  return <RNTextInput {...props} style={[{ fontFamily: FONT_UI }, props.style]} />;
}
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MediaStream, RTCView } from 'react-native-webrtc';
import { LuxlabApi, RoomSession } from './src/api';
import { RoomMediaClient } from './src/realtime';
import { DEFAULT_SHARE_QUALITY, FRAME_RATES, RESOLUTIONS, ShareQuality } from './src/shareQuality';

type Member = { id: string; profile: { name: string }; sharing: boolean };
type Dialog = { title: string; message: string } | null;
const DEFAULT_SERVER = 'https://luxlab.net.br';
const SERVER_STORAGE_KEY = '@luxlab/server';
const AudioOutput = NativeModules.AudioOutput as { setSpeaker: (enabled: boolean) => Promise<boolean>; reset: () => void } | undefined;

export default function App() { return <SafeAreaProvider><LuxlabApp /></SafeAreaProvider>; }

function LuxlabApp() {
  const insets = useSafeAreaInsets();
  const viewport = useWindowDimensions();
  const [server, setServer] = useState(DEFAULT_SERVER); const [serverDraft, setServerDraft] = useState(DEFAULT_SERVER);
  const [settingsOpen, setSettingsOpen] = useState(false); const [dialog, setDialog] = useState<Dialog>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false); const [selectedMember, setSelectedMember] = useState<Member>();
  const [memberVolumes, setMemberVolumes] = useState<Record<string, number>>({}); const [confirmLeave, setConfirmLeave] = useState(false);
  const [name, setName] = useState('Visitante'); const [roomCode, setRoomCode] = useState(''); const [room, setRoom] = useState<RoomSession>();
  const [members, setMembers] = useState<Member[]>([]); const [remote, setRemote] = useState<MediaStream>(); const [selectedStreamId, setSelectedStreamId] = useState<string>();
  const [shareQuality, setShareQuality] = useState<ShareQuality>(DEFAULT_SHARE_QUALITY);
  const [shareBusy, setShareBusy] = useState(false);
  const shareBusyRef = useRef(false);
  const [sharing, setSharing] = useState(false); const [connecting, setConnecting] = useState(false); const [mediaReady, setMediaReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false); const [videoScale, setVideoScale] = useState(1); const [viewerVolume, setViewerVolume] = useState(100); const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const socket = useRef<WebSocket | undefined>(undefined); const media = useRef<RoomMediaClient | undefined>(undefined); const self = useRef<string | undefined>(undefined);
  const remoteStreams = useRef(new Map<string, MediaStream>());
  const pinchStart = useRef(0); const scaleStart = useRef(1); const videoScaleRef = useRef(1);
  const sheetResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 8,
    onPanResponderRelease: (_event, gesture) => {
      if (gesture.dy < -20) setSheetExpanded(true);
      if (gesture.dy > 20) setSheetExpanded(false);
    },
  })).current;
  const videoResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: event => event.nativeEvent.touches.length >= 2,
    onMoveShouldSetPanResponder: event => event.nativeEvent.touches.length >= 2,
    onPanResponderGrant: event => {
      if (event.nativeEvent.touches.length < 2) return;
      const [a, b] = event.nativeEvent.touches;
      pinchStart.current = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
      scaleStart.current = videoScaleRef.current;
    },
    onPanResponderMove: event => {
      if (event.nativeEvent.touches.length < 2) return;
      const [a, b] = event.nativeEvent.touches;
      const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
      if (!pinchStart.current) { pinchStart.current = distance; scaleStart.current = videoScaleRef.current; return; }
      const nextScale = Math.max(1, Math.min(4, scaleStart.current * distance / pinchStart.current));
      videoScaleRef.current = nextScale; setVideoScale(nextScale);
    },
    onPanResponderRelease: () => { pinchStart.current = 0; },
  })).current;

  useEffect(() => {
    AsyncStorage.getItem(SERVER_STORAGE_KEY).then(saved => { if (saved) { setServer(saved); setServerDraft(saved); } }).catch(() => undefined);
    return disconnect;
  }, []);

  useEffect(() => {
    if (!room) return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      setConfirmLeave(true);
      return true;
    });
    return () => handler.remove();
  }, [room]);

  function showError(error: unknown) { setDialog({ title: 'Algo nao saiu como esperado', message: error instanceof Error ? error.message : 'Ocorreu um erro inesperado.' }); }
  function disconnect() { socket.current?.close(); media.current?.close(); AudioOutput?.reset(); socket.current = undefined; media.current = undefined; }

  async function saveServer() {
    const normalized = serverDraft.trim().replace(/\/$/, '');
    if (!/^https?:\/\/[^\s]+$/i.test(normalized)) { setDialog({ title: 'Servidor invalido', message: 'Informe um endereco completo, como https://luxlab.net.br' }); return; }
    try { await AsyncStorage.setItem(SERVER_STORAGE_KEY, normalized); setServer(normalized); setServerDraft(normalized); setSettingsOpen(false); } catch (error) { showError(error); }
  }

  async function enter(create: boolean) {
    if (!create && !roomCode.trim()) { setDialog({ title: 'Codigo necessario', message: 'Digite o codigo da sala que voce recebeu.' }); return; }
    setConnecting(true);
    try {
      const api = new LuxlabApi(server);
      const session = create ? await api.createRoom(name.trim() || 'Visitante') : await api.joinRoom(roomCode.trim(), name.trim() || 'Visitante');
      setRoom(session); setRoomCode(session.roomId);
      const client = media.current = new RoomMediaClient(session.iceServers || [], session.iceTransportPolicy || 'all', (memberId, stream) => {
        if (stream) remoteStreams.current.set(memberId, stream); else remoteStreams.current.delete(memberId);
        if (selectedStreamId === memberId) {
          setRemote(stream);
        }
      }, message => socket.current?.send(JSON.stringify(message)));
      const ws = socket.current = new WebSocket(new URL('/ws', server).toString().replace(/^http/, 'ws'));
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', token: session.token }));
      ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'joined') { self.current = message.self; client.start(message.self); setMediaReady(true); }
        if (message.type === 'members') {
          setMembers(message.members);
          client.syncMembers((message.members as Member[]).map(member => member.id)).catch(showError);
        }
        if (message.type === 'signal') client.signal(message.from, message.payload).catch(showError);
      };
      ws.onerror = () => showError(new Error('Falha na conexao com a sala.'));
    } catch (error) { showError(error); setRoom(undefined); disconnect(); } finally { setConnecting(false); }
  }

  async function toggleShare() {
    if (shareBusyRef.current) return;
    if (!mediaReady) { setDialog({ title: 'Conectando midia', message: 'Aguarde alguns instantes e tente novamente.' }); return; }
    shareBusyRef.current = true; setShareBusy(true);
    const client = media.current;
    try {
      if (sharing) { await media.current?.stopPublishing(); socket.current?.send(JSON.stringify({ type: 'sharing', active: false })); setSharing(false); return; }
      if (!client) return;
      const stream = await client.captureScreen(shareQuality);
      if (client !== media.current) { stream.getTracks().forEach(track => track.stop()); return; }
      try { await client.publish(stream); } catch (error) { await client.stopPublishing(); throw error; }
      socket.current?.send(JSON.stringify({ type: 'sharing', active: true })); setSharing(true);
      if (!stream.getAudioTracks().length) setDialog({ title: 'Audio da transmissao indisponivel', message: 'O Android autorizou apenas a imagem. Verifique se o aparelho e o aplicativo permitem capturar audio interno.' });
    } catch (error) { showError(error); } finally { shareBusyRef.current = false; setShareBusy(false); }
  }

  async function shareInvite() {
    if (!room) return;
    const inviteUrl = `${server}/room/${encodeURIComponent(room.roomId)}`;
    try {
      await Share.share({
        title: 'Convite para a sala Luxlab',
        message: `Entre na minha sala Luxlab\n\nCodigo: ${room.roomId}\n${inviteUrl}`,
        url: inviteUrl,
      });
    } catch (error) { showError(error); }
  }

  function resetZoom() { videoScaleRef.current = 1; setVideoScale(1); }
  function selectStream(memberId?: string) {
    setSelectedStreamId(memberId);
    setRemote(memberId ? remoteStreams.current.get(memberId) : undefined);
  }
  function leaveRoom() { disconnect(); remoteStreams.current.clear(); setRoom(undefined); setMembers([]); setRemote(undefined); setSelectedStreamId(undefined); setSharing(false); setMediaReady(false); setFullscreen(false); setSpeakerEnabled(true); resetZoom(); self.current = undefined; }
  function setTransmissionVolume(value: number) {
    setViewerVolume(value);
    remote?.getAudioTracks().forEach(track => track._setVolume(value / 100));
  }
  async function toggleAudioOutput() {
    if (Platform.OS !== 'android' || !AudioOutput) { setDialog({ title: 'Saida de audio indisponivel', message: 'Este controle esta disponivel no aplicativo Android.' }); return; }
    const next = !speakerEnabled;
    try { await AudioOutput.setSpeaker(next); setSpeakerEnabled(next); } catch (error) { showError(error); }
  }
  function setMemberVolume(member: Member, value: number) {
    setMemberVolumes(current => ({ ...current, [member.id]: value }));
    remoteStreams.current.get(member.id)?.getAudioTracks().forEach(track => track._setVolume(value / 100));
  }
  const landscape = viewport.width > viewport.height;
  const safeStyle = { paddingLeft: Math.max(insets.left, 20), paddingRight: Math.max(insets.right, 20), paddingTop: Math.max(insets.top, 14), paddingBottom: Math.max(insets.bottom, 14) };
  const activeSharingMembers = members.filter(member => member.sharing && member.id !== self.current);
  const previewMember = activeSharingMembers.find(member => member.id === selectedStreamId) ?? activeSharingMembers[0];

  if (!room) return <View style={[styles.page, safeStyle]}>
    <StatusBar barStyle="light-content" />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.homeScroll} keyboardShouldPersistTaps="handled"><View style={styles.content}>
        <View style={styles.topBar}><View style={styles.brand}><Image source={require('./assets/icon.png')} style={styles.homeIcon} accessibilityLabel="P2P Screen" /><View><Text display style={styles.logo}>P2P Screen</Text><Text style={styles.serverStatus}>● Servidor conectado</Text></View></View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Configurar servidor" style={styles.iconButton} onPress={() => { setServerDraft(server); setSettingsOpen(true); }}><Text style={styles.settingsIcon}>⚙</Text></TouchableOpacity>
        </View>
        <View style={styles.hero}><Text display style={styles.eyebrow}>COMPARTILHAMENTO SEGURO</Text><Text display style={styles.title}>Compartilhe sua tela.</Text><Text style={styles.subtitle}>Crie uma sala ou entre usando o codigo de outra pessoa.</Text></View>
        <View style={styles.formCard}>
          <Text style={styles.label}>Seu nome</Text><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Visitante" placeholderTextColor="#8a8a8a" />
          <Text style={styles.label}>Codigo da sala</Text><TextInput style={styles.input} value={roomCode} onChangeText={setRoomCode} autoCapitalize="none" placeholder="Ex.: ABC123" placeholderTextColor="#8a8a8a" />
          <TouchableOpacity disabled={connecting} style={[styles.primary, connecting && styles.disabled]} onPress={() => enter(false)}>{connecting ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryText}>Entrar na sala</Text>}</TouchableOpacity>
          <TouchableOpacity disabled={connecting} style={styles.secondary} onPress={() => enter(true)}><Text style={styles.buttonText}>Criar nova sala</Text></TouchableOpacity>
        </View>
      </View></ScrollView>
    </KeyboardAvoidingView>
    {connecting && <View style={styles.bootOverlay} pointerEvents="auto">
      <Image source={require('./assets/logo.png')} style={styles.bootLogo} resizeMode="contain" accessibilityLabel="P2P Screen" />
      <ActivityIndicator color="#fff" size="large" />
      <Text display style={styles.bootText}>Entrando na sala…</Text>
    </View>}
    <SettingsModal visible={settingsOpen} value={serverDraft} onChange={setServerDraft} onSave={saveServer} onClose={() => setSettingsOpen(false)} />
    <MessageModal dialog={dialog} onClose={() => setDialog(null)} />
  </View>;

  return <View style={[styles.page, styles.roomPage, fullscreen ? styles.fullscreenPage : safeStyle]}>
    <StatusBar barStyle="light-content" hidden={fullscreen} />
    {!fullscreen && <View style={styles.roomHeader}><View><Text display style={styles.logo}>P2P Screen</Text><Text style={styles.liveStatus}>{mediaReady ? '● CONECTADO' : '● CONECTANDO'}</Text></View>
      <View style={styles.roomActions}><View style={styles.codePill}><Text style={styles.codeLabel}>SALA</Text><Text numberOfLines={1} style={styles.code}>{room.roomId}</Text></View><TouchableOpacity accessibilityLabel="Sair da sala" style={styles.smallIconButton} onPress={leaveRoom}><Text style={styles.leaveIcon}>×</Text></TouchableOpacity></View>
    </View>}
    <View style={[styles.roomBody, landscape && styles.roomBodyLandscape]}>
    <View style={[styles.stage, fullscreen && styles.fullscreenStage]} {...videoResponder.panHandlers}>{remote ? <><RTCView key={remote.id} streamURL={remote.toURL()} style={[styles.video, { transform: [{ scale: videoScale }] }]} objectFit="contain" /><View style={[styles.videoTools, fullscreen && { top: Math.max(insets.top, 12), right: Math.max(insets.right, 12) }]}><TouchableOpacity style={styles.videoTool} onPress={resetZoom}><Text style={styles.videoToolText}>{Math.round(videoScale * 100)}%</Text></TouchableOpacity><TouchableOpacity style={styles.videoTool} onPress={() => setFullscreen(value => !value)}><Text style={styles.videoToolText}>{fullscreen ? '⊠ Sair' : '⛶ Tela cheia'}</Text></TouchableOpacity></View></> : <View style={[styles.emptyState, activeSharingMembers.length > 0 && styles.previewState]}>
        <View style={[styles.previewGlow, activeSharingMembers.length > 0 && styles.previewGlowVisible]} />
        <Text style={styles.previewEye}>◉</Text>
        <Text display style={styles.emptyTitle}>{activeSharingMembers.length > 0 ? 'Selecione uma transmissao' : 'Aguardando transmissao'}</Text>
        <Text style={styles.empty}>{activeSharingMembers.length > 0 ? 'Toque em uma tela ativa para assistir. A primeira opção não entra automaticamente.' : 'Quando alguem compartilhar a tela, ela aparecera aqui.'}</Text>
        {activeSharingMembers.length > 0 && (
          <TouchableOpacity style={styles.previewCallout} onPress={() => previewMember && selectStream(previewMember.id)}>
            <Text style={styles.previewCalloutText}>{previewMember?.profile.name || 'Tela em andamento'}</Text>
          </TouchableOpacity>
        )}
      </View>}</View>
    {!fullscreen && <ScrollView style={[styles.controlPanelScroll, landscape && styles.controlPanelLandscape]} contentContainerStyle={styles.controlPanel} nestedScrollEnabled>
      <View {...sheetResponder.panHandlers}><TouchableOpacity accessibilityLabel={sheetExpanded ? 'Recolher menu' : 'Expandir menu'} style={styles.sheetHandleArea} onPress={() => setSheetExpanded(value => !value)}><View style={styles.sheetHandle} /><Text style={styles.sheetHint}>{sheetExpanded ? 'Click aqui!' : 'Clik aqui!'}</Text></TouchableOpacity></View>
      <View style={styles.participantsRow}><View style={styles.participantNames}><Text style={styles.participantsTitle}>{members.length} participante(s)</Text><Text numberOfLines={1} style={styles.people}>{members.map(member => member.profile.name).join(', ') || 'Aguardando participantes'}</Text></View><View style={styles.avatar}><Text style={styles.avatarText}>{members.length}</Text></View></View>
      {sheetExpanded && <ScrollView style={styles.memberList} contentContainerStyle={styles.memberListContent} nestedScrollEnabled>
        <Text style={styles.sectionLabel}>NA SALA</Text>
        {members.map(member => <TouchableOpacity key={member.id} style={[styles.memberRow, member.sharing && selectedStreamId === member.id && styles.memberSelected]} delayLongPress={350} onPress={() => member.sharing && selectStream(member.id)} onLongPress={() => setSelectedMember(member)}>
          <View style={[styles.memberAvatar, member.sharing && styles.memberAvatarActive]}><Text style={styles.memberAvatarText}>{(member.profile.name || 'V').slice(0, 1).toUpperCase()}</Text></View>
          <View style={styles.memberInfo}><Text style={styles.memberName}>{member.profile.name}{member.id === self.current ? ' (voce)' : ''}</Text><Text style={styles.memberState}>{member.sharing ? 'Compartilhando tela' : 'Na sala'} · {member.sharing ? 'Toque para assistir' : 'Segure para ajustar o volume'}</Text></View>
          <Text style={styles.memberVolume}>{member.sharing ? '👁' : `${memberVolumes[member.id] ?? 100}%`}</Text>
        </TouchableOpacity>)}
      </ScrollView>}
      <TouchableOpacity style={styles.inviteButton} onPress={shareInvite}><Text style={styles.inviteButtonText}>↗  Convidar pessoas</Text></TouchableOpacity>
      {remote && <View style={styles.transmissionVolume}><View style={styles.transmissionVolumeHeader}><Text style={styles.transmissionVolumeTitle}>♫ Volume da transmissao</Text><Text style={styles.sliderValue}>{Math.round(viewerVolume)}%</Text></View><Slider style={styles.wideSlider} minimumValue={0} maximumValue={100} step={1} value={viewerVolume} onValueChange={setTransmissionVolume} minimumTrackTintColor="#ffffff" maximumTrackTintColor="#3a3a3a" thumbTintColor="#ffffff" /><TouchableOpacity accessibilityRole="button" accessibilityLabel={`Usar ${speakerEnabled ? 'telefone' : 'alto-falante'}`} style={styles.audioOutputButton} onPress={toggleAudioOutput}><View><Text style={styles.audioOutputLabel}>Dispositivo de saida</Text><Text style={styles.audioOutputValue}>{speakerEnabled ? 'Alto-falante' : 'Telefone'}</Text></View><Text style={styles.audioOutputIcon}>{speakerEnabled ? 'VOL' : 'TEL'}</Text></TouchableOpacity></View>}
      <View style={styles.qualityPanel}>
        <Text style={styles.participantsTitle}>Qualidade do compartilhamento</Text>
        <View style={styles.qualityOptions}>{RESOLUTIONS.map(resolution => <TouchableOpacity key={resolution} accessibilityRole="button" accessibilityState={{ selected: shareQuality.resolution === resolution, disabled: sharing || shareBusy }} disabled={sharing || shareBusy} style={[styles.qualityOption, shareQuality.resolution === resolution && styles.qualitySelected]} onPress={() => setShareQuality(current => ({ ...current, resolution }))}><Text style={shareQuality.resolution === resolution ? styles.primaryText : styles.videoToolText}>{resolution}p</Text></TouchableOpacity>)}</View>
        <View style={styles.qualityOptions}>{FRAME_RATES.map(fps => <TouchableOpacity key={fps} accessibilityRole="button" accessibilityState={{ selected: shareQuality.fps === fps, disabled: sharing || shareBusy }} disabled={sharing || shareBusy} style={[styles.qualityOption, shareQuality.fps === fps && styles.qualitySelected]} onPress={() => setShareQuality(current => ({ ...current, fps }))}><Text style={shareQuality.fps === fps ? styles.primaryText : styles.videoToolText}>{fps} FPS</Text></TouchableOpacity>)}</View>
        <Text style={styles.people}>{sharing ? 'Pare o compartilhamento para alterar a qualidade.' : 'Resolucao maxima no lado menor da tela. FPS e qualidade variam conforme aparelho e conexao.'}</Text>
      </View>
      <TouchableOpacity disabled={!mediaReady || shareBusy} style={[sharing ? styles.stop : styles.primary, !mediaReady && styles.disabled]} onPress={toggleShare}><Text style={sharing ? styles.buttonText : styles.primaryText}>{sharing ? '■  Parar compartilhamento' : '▣  Compartilhar tela'}</Text></TouchableOpacity>
      {sheetExpanded && <TouchableOpacity style={styles.endRoomButton} onPress={() => setConfirmLeave(true)}><Text style={styles.endRoomText}>Encerrar e sair da sala</Text></TouchableOpacity>}
    </ScrollView>}
    </View>
    <VolumeModal member={selectedMember} value={selectedMember ? memberVolumes[selectedMember.id] ?? 100 : 100} onChange={value => selectedMember && setMemberVolume(selectedMember, value)} onClose={() => setSelectedMember(undefined)} />
    <ConfirmModal visible={confirmLeave} onCancel={() => setConfirmLeave(false)} onConfirm={() => { setConfirmLeave(false); leaveRoom(); }} />
    <MessageModal dialog={dialog} onClose={() => setDialog(null)} />
  </View>;
}

function SettingsModal({ visible, value, onChange, onSave, onClose }: { visible: boolean; value: string; onChange: (value: string) => void; onSave: () => void; onClose: () => void }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}><View style={styles.modalCard}>
    <View style={styles.modalHeader}><View><Text display style={styles.modalEyebrow}>CONFIGURACOES</Text><Text display style={styles.modalTitle}>Servidor Luxlab</Text></View><TouchableOpacity style={styles.smallIconButton} onPress={onClose}><Text style={styles.leaveIcon}>×</Text></TouchableOpacity></View>
    <Text style={styles.modalHelp}>O servidor oficial ja esta configurado. Altere somente para conectar a uma instalacao propria.</Text><Text style={styles.label}>Endereco do servidor</Text>
    <TextInput style={styles.input} value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://seu-servidor.com" placeholderTextColor="#8a8a8a" />
    <TouchableOpacity style={styles.primary} onPress={onSave}><Text style={styles.primaryText}>Salvar servidor</Text></TouchableOpacity>
  </View></KeyboardAvoidingView></View></Modal>;
}

function MessageModal({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  return <Modal visible={Boolean(dialog)} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.messageCard}><View style={styles.messageIcon}><Text style={styles.messageIconText}>!</Text></View><Text display style={styles.messageTitle}>{dialog?.title}</Text><Text style={styles.messageText}>{dialog?.message}</Text><TouchableOpacity style={styles.primary} onPress={onClose}><Text style={styles.primaryText}>Entendi</Text></TouchableOpacity></View></View></Modal>;
}

function VolumeModal({ member, value, onChange, onClose }: { member?: Member; value: number; onChange: (value: number) => void; onClose: () => void }) {
  return <Modal visible={Boolean(member)} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.messageCard}>
    <View style={styles.memberAvatarLarge}><Text style={styles.memberAvatarText}>{(member?.profile.name || 'V').slice(0, 1).toUpperCase()}</Text></View><Text display style={styles.messageTitle}>{member?.profile.name}</Text><Text style={styles.messageText}>Volume individual</Text>
    <View style={styles.sliderRow}><Text style={styles.sliderIcon}>{value === 0 ? '×' : '♪'}</Text><Slider style={styles.slider} minimumValue={0} maximumValue={100} step={1} value={value} onValueChange={onChange} minimumTrackTintColor="#ffffff" maximumTrackTintColor="#3a3a3a" thumbTintColor="#ffffff" /><Text style={styles.sliderValue}>{Math.round(value)}%</Text></View>
    <TouchableOpacity style={styles.primary} onPress={onClose}><Text style={styles.primaryText}>Concluir</Text></TouchableOpacity>
  </View></View></Modal>;
}

function ConfirmModal({ visible, onCancel, onConfirm }: { visible: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}><View style={styles.modalBackdrop}><View style={styles.messageCard}><View style={styles.messageIcon}><Text style={styles.messageIconText}>×</Text></View><Text display style={styles.messageTitle}>Encerrar participacao?</Text><Text style={styles.messageText}>O compartilhamento sera interrompido e voce saira desta sala.</Text><TouchableOpacity style={styles.stop} onPress={onConfirm}><Text style={styles.buttonText}>Encerrar e sair</Text></TouchableOpacity><TouchableOpacity style={styles.cancelButton} onPress={onCancel}><Text style={styles.cancelButtonText}>Continuar na sala</Text></TouchableOpacity></View></View></Modal>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, page: { flex: 1, backgroundColor: '#000', paddingHorizontal: 20 }, roomPage: { gap: 14 }, fullscreenPage: { paddingHorizontal: 0, gap: 0 }, homeScroll: { flexGrow: 1, alignItems: 'center' }, content: { width: '100%', maxWidth: 520 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { flexDirection: 'row', alignItems: 'center', gap: 10 }, homeIcon: { width: 42, height: 42, borderRadius: 12 }, logo: { color: '#f5f5f5', fontSize: 20, fontWeight: '800' }, serverStatus: { color: '#c8c8c8', fontSize: 11, marginTop: 3 },
  bootOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 20 }, bootLogo: { width: 280, height: 280 }, bootText: { color: '#e8e8e8', fontWeight: '700' },
  iconButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#141414', borderWidth: 1, borderColor: '#2e2e2e' }, settingsIcon: { color: '#f5f5f5', fontSize: 25 },
  hero: { marginTop: 48, marginBottom: 30 }, eyebrow: { color: '#9a9a9a', fontSize: 11, fontWeight: '800', letterSpacing: 1.6 }, title: { color: '#f5f5f5', fontSize: 38, lineHeight: 44, fontWeight: '800', marginTop: 10 }, subtitle: { color: '#8a8a8a', fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 360 },
  formCard: { backgroundColor: '#121212', borderColor: '#2e2e2e', borderWidth: 1, borderRadius: 20, padding: 18, gap: 11 }, label: { color: '#c8c8c8', fontSize: 12, fontWeight: '700', marginTop: 2 }, input: { color: '#f5f5f5', backgroundColor: '#161616', borderColor: '#2e2e2e', borderWidth: 1, borderRadius: 13, paddingHorizontal: 15, minHeight: 52 },
  primary: { minHeight: 54, backgroundColor: '#fff', paddingHorizontal: 16, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 4 }, secondary: { minHeight: 54, backgroundColor: '#1a1a1a', paddingHorizontal: 16, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#2e2e2e' }, stop: { minHeight: 54, backgroundColor: '#111', paddingHorizontal: 16, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 4, borderWidth: 1, borderColor: '#fff' }, disabled: { opacity: 0.5 }, buttonText: { color: '#fff', fontWeight: '800' }, primaryText: { color: '#000', fontWeight: '800' },
  roomHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, liveStatus: { color: '#c8c8c8', fontSize: 9, fontWeight: '800', marginTop: 2, letterSpacing: 1 }, roomActions: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '70%' }, codePill: { backgroundColor: '#161616', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, alignItems: 'flex-end', flexShrink: 1 }, codeLabel: { color: '#8a8a8a', fontSize: 8, fontWeight: '800', letterSpacing: 1 }, code: { color: '#e8e8e8', fontSize: 12, letterSpacing: 2 },
  smallIconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#1a1a1a' }, leaveIcon: { color: '#e8e8e8', fontSize: 25, lineHeight: 27 },
  roomBody: { flex: 1, minHeight: 0, gap: 14 }, roomBodyLandscape: { flexDirection: 'row' }, controlPanelScroll: { flexGrow: 0, flexShrink: 1, maxHeight: '60%' }, controlPanelLandscape: { width: 300, maxHeight: '100%' },
  stage: { flex: 1, minHeight: 0, backgroundColor: '#0a0a0a', borderRadius: 20, overflow: 'hidden', borderColor: '#1a1a1a', borderWidth: 1, justifyContent: 'center' }, fullscreenStage: { borderRadius: 0, borderWidth: 0 }, video: { flex: 1 }, videoTools: { position: 'absolute', right: 12, top: 12, flexDirection: 'row', gap: 8 }, videoTool: { minHeight: 38, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.88)', borderWidth: 1, borderColor: '#3a3a3a' }, videoToolText: { color: '#f5f5f5', fontSize: 11, fontWeight: '800' }, emptyState: { flex: 1, padding: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' }, previewState: { borderWidth: 1, borderColor: '#2f2f2f' }, previewGlow: { position: 'absolute', inset: 0, backgroundColor: 'rgba(255,255,255,0.06)', opacity: 0 }, previewGlowVisible: { opacity: 1 }, previewEye: { color: '#f5f5f5', fontSize: 32, marginBottom: 12, opacity: 0.9 }, emptyIcon: { color: '#fff', fontSize: 32, marginBottom: 13 }, emptyTitle: { color: '#f5f5f5', fontWeight: '700', fontSize: 16 }, empty: { color: '#8a8a8a', textAlign: 'center', lineHeight: 20, marginTop: 7 }, previewCallout: { marginTop: 18, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: '#3a3a3a', backgroundColor: 'rgba(255,255,255,0.05)' }, previewCalloutText: { color: '#f5f5f5', fontWeight: '700' },
  controlPanel: { backgroundColor: '#121212', borderRadius: 18, paddingHorizontal: 14, paddingBottom: 14, borderWidth: 1, borderColor: '#2e2e2e', gap: 12 }, controlPanelExpanded: { maxHeight: '68%' }, sheetHandleArea: { alignItems: 'center', paddingTop: 9, paddingBottom: 2 }, sheetHandle: { width: 46, height: 4, borderRadius: 2, backgroundColor: '#3a3a3a' }, sheetHint: { color: '#8a8a8a', fontSize: 9, marginTop: 5 }, participantsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, participantNames: { flex: 1, paddingRight: 10 }, participantsTitle: { color: '#f5f5f5', fontSize: 13, fontWeight: '700' }, people: { color: '#8a8a8a', fontSize: 11, marginTop: 3 }, avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2a2a2a' }, avatarText: { color: '#f5f5f5', fontWeight: '800', fontSize: 12 },
  memberList: { maxHeight: 220 }, memberListContent: { gap: 8 }, sectionLabel: { color: '#8a8a8a', fontSize: 9, fontWeight: '800', letterSpacing: 1.5, marginVertical: 3 }, memberRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', backgroundColor: '#161616', borderRadius: 13, padding: 10, borderWidth: 1, borderColor: '#2e2e2e' }, memberSelected: { borderColor: '#f5f5f5', backgroundColor: '#202020' }, memberAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2a2a2a' }, memberAvatarActive: { borderWidth: 1, borderColor: '#f5f5f5' }, memberAvatarLarge: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2a2a2a' }, memberAvatarText: { color: '#fff', fontWeight: '900', fontSize: 16 }, memberInfo: { flex: 1, paddingHorizontal: 10 }, memberName: { color: '#f5f5f5', fontWeight: '700', fontSize: 13 }, memberState: { color: '#8a8a8a', fontSize: 9, marginTop: 3 }, memberVolume: { color: '#fff', fontSize: 11, fontWeight: '800' },
  inviteButton: { minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#fff', backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' }, inviteButtonText: { color: '#fff', fontWeight: '800' },
  qualityPanel: { gap: 8 }, qualityOptions: { flexDirection: 'row', gap: 8 }, qualityOption: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#2e2e2e', backgroundColor: '#161616' }, qualitySelected: { borderColor: '#fff', backgroundColor: '#fff' },
  transmissionVolume: { backgroundColor: '#161616', borderRadius: 12, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10 }, transmissionVolumeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, transmissionVolumeTitle: { color: '#e8e8e8', fontSize: 11, fontWeight: '700' }, wideSlider: { width: '100%', height: 38 },
  audioOutputButton: { minHeight: 50, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: '#2e2e2e', backgroundColor: '#1a1a1a', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, audioOutputLabel: { color: '#8a8a8a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.7 }, audioOutputValue: { color: '#f5f5f5', fontSize: 14, fontWeight: '800', marginTop: 2 }, audioOutputIcon: { color: '#fff', fontSize: 11, fontWeight: '900' },
  endRoomButton: { minHeight: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: '#fff' }, endRoomText: { color: '#fff', fontWeight: '800' }, cancelButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, cancelButtonText: { color: '#c8c8c8', fontWeight: '700' }, sliderRow: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 8 }, slider: { flex: 1, height: 44 }, sliderIcon: { color: '#fff', fontSize: 20 }, sliderValue: { width: 40, color: '#f5f5f5', textAlign: 'right', fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.82)', alignItems: 'center', justifyContent: 'center', padding: 20 }, modalWrap: { width: '100%', maxWidth: 500 }, modalCard: { width: '100%', backgroundColor: '#121212', borderColor: '#2e2e2e', borderWidth: 1, borderRadius: 22, padding: 20, gap: 14 }, modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, modalEyebrow: { color: '#9a9a9a', fontSize: 9, fontWeight: '800', letterSpacing: 1.5 }, modalTitle: { color: '#f5f5f5', fontSize: 23, fontWeight: '800', marginTop: 3 }, modalHelp: { color: '#8a8a8a', lineHeight: 20 },
  messageCard: { width: '100%', maxWidth: 390, alignItems: 'center', backgroundColor: '#121212', borderColor: '#2e2e2e', borderWidth: 1, borderRadius: 22, padding: 22, gap: 12 }, messageIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' }, messageIconText: { color: '#fff', fontWeight: '900', fontSize: 22 }, messageTitle: { color: '#f5f5f5', fontSize: 20, fontWeight: '800', textAlign: 'center' }, messageText: { color: '#8a8a8a', textAlign: 'center', lineHeight: 20 },
});
