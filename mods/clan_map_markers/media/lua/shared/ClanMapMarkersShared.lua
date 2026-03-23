--[[ Shared constants — loaded on client + server ]]

ClanMapMarkersShared = ClanMapMarkersShared or {}

ClanMapMarkersShared.MOD = "ClanMapMarkers"
ClanMapMarkersShared.MOD_DATA = "ClanMapMarkersData"

-- Commands (client -> server)
ClanMapMarkersShared.CMD_SET_MANUAL_TAG = "setManualTag"
ClanMapMarkersShared.CMD_PUSH_MARKERS = "pushMarkers"
ClanMapMarkersShared.CMD_REQUEST_SYNC = "requestSync"

-- Commands (server -> client)
ClanMapMarkersShared.CMD_SYNC = "clanMarkersSync"
