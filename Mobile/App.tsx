import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StatusBar, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MediaStream, RTCView } from 'react-native-webrtc';
import { LuxlabApi, RoomSession } from './src/api';
import { CloudflareMediaClient, RemoteMedia } from './src/realtime';

type Member = { id: string; profile: { name: string }; sharing: boolean; media: RemoteMedia | null };
type Dialog = { title: string; message: string } | null;
const DEFAULT_SERVER = 'https://luxlab.net.br';
const SERVER_STORAGE_KEY = '@luxlab/server';

export default function App() { return <SafeAreaProvider><LuxlabApp /></SafeAreaProvider>; }

function LuxlabApp() {
  const insets = useSafeAreaInsets();
  const [server, setServer] = useState(DEFAULT_SERVER); const [serverDraft, setServerDraft] = useState(DEFAULT_SERVER);
  const [settingsOpen, setSettingsOpen] = useState(false); const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState('Visitante'); const [roomCode, setRoomCode] = useState(''); const [room, setRoom] = useState<RoomSession>();
  const [members, setMembers] = useState<Member[]>([]); const [remote, setRemote] = useState<MediaStream>();
  const [sharing, setSharing] = useState(false); const [connecting, setConnecting] = useState(false); const [mediaReady, setMediaReady] = useState(false);
  const socket = useRef<WebSocket | undefined>(undefined); const media = useRef<CloudflareMediaClient | undefined>(undefined); const self = useRef<string | undefined>(undefined);

  useEffect(() => {
    AsyncStorage.getItem(SERVER_STORAGE_KEY).then(saved => { if (saved) { setServer(saved); setServerDraft(saved); } }).catch(() => undefined);
    return disconnect;
  }, []);

  function showError(error: unknown) { setDialog({ title: 'Algo nao saiu como esperado', message: error instanceof Error ? error.message : 'Ocorreu um erro inesperado.' }); }
  function disconnect() { socket.current?.close(); media.current?.close(); socket.current = undefined; media.current = undefined; }

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
      const client = media.current = new CloudflareMediaClient(api, session.token, setRemote);
      const ws = socket.current = new WebSocket(new URL('/ws', server).toString().replace(/^http/, 'ws'));
      ws.onopen = () => ws.send(JSON.stringify({ type: 'join', token: session.token }));
      ws.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.type === 'joined') { self.current = message.self; client.connect().then(() => setMediaReady(true)).catch(showError); }
        if (message.type === 'members') {
          setMembers(message.members);
          for (const member of message.members as Member[]) if (member.id !== self.current && member.media?.tracks.length) client.subscribe(member.media).catch(showError);
        }
      };
      ws.onerror = () => showError(new Error('Falha na conexao com a sala.'));
    } catch (error) { showError(error); setRoom(undefined); disconnect(); } finally { setConnecting(false); }
  }

  async function toggleShare() {
    if (!mediaReady) { setDialog({ title: 'Conectando midia', message: 'Aguarde alguns instantes e tente novamente.' }); return; }
    try {
      if (sharing) { await media.current?.stopPublishing(); socket.current?.send(JSON.stringify({ type: 'sharing', active: false })); setSharing(false); return; }
      const stream = await media.current!.captureScreen(); await media.current!.publish(stream);
      socket.current?.send(JSON.stringify({ type: 'sharing', active: true })); setSharing(true);
    } catch (error) { showError(error); }
  }

  function leaveRoom() { disconnect(); setRoom(undefined); setMembers([]); setRemote(undefined); setSharing(false); setMediaReady(false); self.current = undefined; }
  const safeStyle = { paddingTop: Math.max(insets.top, 14), paddingBottom: Math.max(insets.bottom, 14) };

  if (!room) return <View style={[styles.page, safeStyle]}>
    <StatusBar barStyle="light-content" />
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.homeScroll} keyboardShouldPersistTaps="handled"><View style={styles.content}>
        <View style={styles.topBar}><View><Text style={styles.logo}>Luxlab</Text><Text style={styles.serverStatus}>● Servidor conectado</Text></View>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Configurar servidor" style={styles.iconButton} onPress={() => { setServerDraft(server); setSettingsOpen(true); }}><Text style={styles.settingsIcon}>⚙</Text></TouchableOpacity>
        </View>
        <View style={styles.hero}><Text style={styles.eyebrow}>COMPARTILHAMENTO SEGURO</Text><Text style={styles.title}>Compartilhe sua tela.</Text><Text style={styles.subtitle}>Crie uma sala ou entre usando o codigo de outra pessoa.</Text></View>
        <View style={styles.formCard}>
          <Text style={styles.label}>Seu nome</Text><TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Visitante" placeholderTextColor="#667085" />
          <Text style={styles.label}>Codigo da sala</Text><TextInput style={styles.input} value={roomCode} onChangeText={setRoomCode} autoCapitalize="none" placeholder="Ex.: ABC123" placeholderTextColor="#667085" />
          <TouchableOpacity disabled={connecting} style={[styles.primary, connecting && styles.disabled]} onPress={() => enter(false)}>{connecting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Entrar na sala</Text>}</TouchableOpacity>
          <TouchableOpacity disabled={connecting} style={styles.secondary} onPress={() => enter(true)}><Text style={styles.buttonText}>Criar nova sala</Text></TouchableOpacity>
        </View>
      </View></ScrollView>
    </KeyboardAvoidingView>
    <SettingsModal visible={settingsOpen} value={serverDraft} onChange={setServerDraft} onSave={saveServer} onClose={() => setSettingsOpen(false)} />
    <MessageModal dialog={dialog} onClose={() => setDialog(null)} />
  </View>;

  return <View style={[styles.page, styles.roomPage, safeStyle]}>
    <StatusBar barStyle="light-content" />
    <View style={styles.roomHeader}><View><Text style={styles.logo}>Luxlab</Text><Text style={styles.liveStatus}>{mediaReady ? '● CONECTADO' : '● CONECTANDO'}</Text></View>
      <View style={styles.roomActions}><View style={styles.codePill}><Text style={styles.codeLabel}>SALA</Text><Text numberOfLines={1} style={styles.code}>{room.roomId}</Text></View><TouchableOpacity accessibilityLabel="Sair da sala" style={styles.smallIconButton} onPress={leaveRoom}><Text style={styles.leaveIcon}>×</Text></TouchableOpacity></View>
    </View>
    <View style={styles.stage}>{remote ? <RTCView streamURL={remote.toURL()} style={styles.video} objectFit="contain" /> : <View style={styles.emptyState}><Text style={styles.emptyIcon}>▣</Text><Text style={styles.emptyTitle}>Aguardando transmissao</Text><Text style={styles.empty}>Quando alguem compartilhar a tela, ela aparecera aqui.</Text></View>}</View>
    <View style={styles.controlPanel}><View style={styles.participantsRow}><View style={styles.participantNames}><Text style={styles.participantsTitle}>{members.length} participante(s)</Text><Text numberOfLines={1} style={styles.people}>{members.map(member => member.profile.name).join(', ') || 'Aguardando participantes'}</Text></View><View style={styles.avatar}><Text style={styles.avatarText}>{members.length}</Text></View></View>
      <TouchableOpacity disabled={!mediaReady} style={[sharing ? styles.stop : styles.primary, !mediaReady && styles.disabled]} onPress={toggleShare}><Text style={styles.buttonText}>{sharing ? '■  Parar compartilhamento' : '▣  Compartilhar tela'}</Text></TouchableOpacity>
    </View>
    <MessageModal dialog={dialog} onClose={() => setDialog(null)} />
  </View>;
}

function SettingsModal({ visible, value, onChange, onSave, onClose }: { visible: boolean; value: string; onChange: (value: string) => void; onSave: () => void; onClose: () => void }) {
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}><View style={styles.modalCard}>
    <View style={styles.modalHeader}><View><Text style={styles.modalEyebrow}>CONFIGURACOES</Text><Text style={styles.modalTitle}>Servidor Luxlab</Text></View><TouchableOpacity style={styles.smallIconButton} onPress={onClose}><Text style={styles.leaveIcon}>×</Text></TouchableOpacity></View>
    <Text style={styles.modalHelp}>O servidor oficial ja esta configurado. Altere somente para conectar a uma instalacao propria.</Text><Text style={styles.label}>Endereco do servidor</Text>
    <TextInput style={styles.input} value={value} onChangeText={onChange} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://seu-servidor.com" placeholderTextColor="#667085" />
    <TouchableOpacity style={styles.primary} onPress={onSave}><Text style={styles.buttonText}>Salvar servidor</Text></TouchableOpacity>
  </View></KeyboardAvoidingView></View></Modal>;
}

function MessageModal({ dialog, onClose }: { dialog: Dialog; onClose: () => void }) {
  return <Modal visible={Boolean(dialog)} transparent animationType="fade" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={styles.messageCard}><View style={styles.messageIcon}><Text style={styles.messageIconText}>!</Text></View><Text style={styles.messageTitle}>{dialog?.title}</Text><Text style={styles.messageText}>{dialog?.message}</Text><TouchableOpacity style={styles.primary} onPress={onClose}><Text style={styles.buttonText}>Entendi</Text></TouchableOpacity></View></View></Modal>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, page: { flex: 1, backgroundColor: '#0c1120', paddingHorizontal: 20 }, roomPage: { gap: 14 }, homeScroll: { flexGrow: 1, alignItems: 'center' }, content: { width: '100%', maxWidth: 520 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, logo: { color: '#b8a9ff', fontSize: 26, fontWeight: '800' }, serverStatus: { color: '#61d6a3', fontSize: 11, marginTop: 3 },
  iconButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#151d2e', borderWidth: 1, borderColor: '#273149' }, settingsIcon: { color: '#b8a9ff', fontSize: 25 },
  hero: { marginTop: 48, marginBottom: 30 }, eyebrow: { color: '#8f7cf0', fontSize: 11, fontWeight: '800', letterSpacing: 1.6 }, title: { color: '#f4f1ff', fontSize: 38, lineHeight: 44, fontWeight: '800', marginTop: 10 }, subtitle: { color: '#99a6bf', fontSize: 15, lineHeight: 22, marginTop: 10, maxWidth: 360 },
  formCard: { backgroundColor: '#11192a', borderColor: '#273149', borderWidth: 1, borderRadius: 20, padding: 18, gap: 11 }, label: { color: '#b9c2d5', fontSize: 12, fontWeight: '700', marginTop: 2 }, input: { color: '#eef0fa', backgroundColor: '#151d2e', borderColor: '#343c56', borderWidth: 1, borderRadius: 13, paddingHorizontal: 15, minHeight: 52 },
  primary: { minHeight: 54, backgroundColor: '#7460df', paddingHorizontal: 16, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 4 }, secondary: { minHeight: 54, backgroundColor: '#293449', paddingHorizontal: 16, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, stop: { minHeight: 54, backgroundColor: '#9b3854', paddingHorizontal: 16, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 4 }, disabled: { opacity: 0.5 }, buttonText: { color: '#fff', fontWeight: '800' },
  roomHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, liveStatus: { color: '#61d6a3', fontSize: 9, fontWeight: '800', marginTop: 2, letterSpacing: 1 }, roomActions: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: '70%' }, codePill: { backgroundColor: '#151d2e', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 7, alignItems: 'flex-end', flexShrink: 1 }, codeLabel: { color: '#667085', fontSize: 8, fontWeight: '800', letterSpacing: 1 }, code: { color: '#c7cde0', fontSize: 12, letterSpacing: 2 },
  smallIconButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#202a40' }, leaveIcon: { color: '#d6dbeb', fontSize: 25, lineHeight: 27 },
  stage: { flex: 1, minHeight: 180, backgroundColor: '#080d18', borderRadius: 20, overflow: 'hidden', borderColor: '#11192a', borderWidth: 1, justifyContent: 'center' }, video: { flex: 1 }, emptyState: { padding: 30, alignItems: 'center' }, emptyIcon: { color: '#7460df', fontSize: 32, marginBottom: 13 }, emptyTitle: { color: '#e8e9f4', fontWeight: '700', fontSize: 16 }, empty: { color: '#8995ac', textAlign: 'center', lineHeight: 20, marginTop: 7 },
  controlPanel: { backgroundColor: '#11192a', borderRadius: 18, padding: 14, borderWidth: 1, borderColor: '#273149', gap: 12 }, participantsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, participantNames: { flex: 1, paddingRight: 10 }, participantsTitle: { color: '#e8e9f4', fontSize: 13, fontWeight: '700' }, people: { color: '#8995ac', fontSize: 11, marginTop: 3 }, avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#342b66' }, avatarText: { color: '#c8bdff', fontWeight: '800', fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(3, 7, 18, 0.82)', alignItems: 'center', justifyContent: 'center', padding: 20 }, modalWrap: { width: '100%', maxWidth: 500 }, modalCard: { width: '100%', backgroundColor: '#11192a', borderColor: '#343c56', borderWidth: 1, borderRadius: 22, padding: 20, gap: 14 }, modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, modalEyebrow: { color: '#8f7cf0', fontSize: 9, fontWeight: '800', letterSpacing: 1.5 }, modalTitle: { color: '#f4f1ff', fontSize: 23, fontWeight: '800', marginTop: 3 }, modalHelp: { color: '#99a6bf', lineHeight: 20 },
  messageCard: { width: '100%', maxWidth: 390, alignItems: 'center', backgroundColor: '#11192a', borderColor: '#343c56', borderWidth: 1, borderRadius: 22, padding: 22, gap: 12 }, messageIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#342b66', alignItems: 'center', justifyContent: 'center' }, messageIconText: { color: '#b8a9ff', fontWeight: '900', fontSize: 22 }, messageTitle: { color: '#f4f1ff', fontSize: 20, fontWeight: '800', textAlign: 'center' }, messageText: { color: '#99a6bf', textAlign: 'center', lineHeight: 20 },
});
