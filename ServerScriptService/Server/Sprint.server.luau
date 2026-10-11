local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)

local remoteFolder = ReplicatedStorage:FindFirstChild("MountRillRemotes")
if not remoteFolder then
	remoteFolder = Instance.new("Folder")
	remoteFolder.Name = "MountRillRemotes"
	remoteFolder.Parent = ReplicatedStorage
end

local sprintRemote = remoteFolder:FindFirstChild("SprintRequest")
if not sprintRemote then
	sprintRemote = Instance.new("RemoteEvent")
	sprintRemote.Name = "SprintRequest"
	sprintRemote.Parent = remoteFolder
end

sprintRemote.OnServerEvent:Connect(function(player: Player, wantsToSprint: unknown)
	if Config.Stamina.DebugSprint then
		print("[Mount Rill][Sprint Server] Request from " .. player.Name .. ": " .. tostring(wantsToSprint))
	end
	if typeof(wantsToSprint) ~= "boolean" then
		if Config.Stamina.DebugSprint then
			warn("[Mount Rill][Sprint Server] Request rejected for " .. player.Name)
		end
		return
	end

	player:SetAttribute("SprintRequested", wantsToSprint)
	if Config.Stamina.DebugSprint then
		print("[Mount Rill][Sprint Server] SprintRequested = " .. tostring(wantsToSprint) .. " for " .. player.Name)
	end
end)
