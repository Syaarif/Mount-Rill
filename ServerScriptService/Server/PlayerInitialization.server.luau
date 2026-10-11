local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)

local function findBasecampSpawn(): SpawnLocation?
	local spawn = workspace:FindFirstChild(Config.Basecamp.SpawnName, true)
	if spawn and spawn:IsA("SpawnLocation") then
		return spawn
	end

	return nil
end

local function findCheckpointPart(checkpointName: string): BasePart?
	for _, checkpoint in ipairs(Config.CheckpointSystem.Checkpoints) do
		if checkpoint.Name == checkpointName then
			local part = workspace:FindFirstChild(checkpoint.PartName, true)
			if part and part:IsA("BasePart") then
				return part
			end
		end
	end

	return nil
end

local function respawnLocationMatchesCheckpoint(player: Player, checkpointName: string): boolean
	local respawnLocation = player.RespawnLocation
	if not respawnLocation then
		return false
	end

	for _, checkpoint in ipairs(Config.CheckpointSystem.Checkpoints) do
		if checkpoint.Name == checkpointName then
			return respawnLocation.Name == checkpoint.SpawnName
		end
	end

	return false
end

local function placeCharacterAtCheckpoint(player: Player, character: Model)
	local checkpointName = player:GetAttribute("Checkpoint")
	if typeof(checkpointName) ~= "string" then
		return
	end

	if respawnLocationMatchesCheckpoint(player, checkpointName) then
		return
	end

	local checkpointPart = findCheckpointPart(checkpointName)
	if checkpointPart then
		character:PivotTo(checkpointPart.CFrame + Vector3.new(0, checkpointPart.Size.Y / 2 + 3, 0))
	end
end

local function initializePlayer(player: Player)
	local defaults = Config.PlayerDefaults

	player:SetAttribute("MountRillInitialized", true)
	player:SetAttribute("Stamina", Config.Stamina.StartingStamina)
	player:SetAttribute("MovementState", "Idle")
	player:SetAttribute("SprintRequested", false)
	player:SetAttribute("Sprinting", false)
	player:SetAttribute("Hydration", defaults.Hydration)
	player:SetAttribute("Energy", defaults.Energy)
	player:SetAttribute("Checkpoint", defaults.Checkpoint)
	player:SetAttribute("RillTokens", defaults.RillTokens)

	local basecampSpawn = findBasecampSpawn()
	if basecampSpawn then
		player.RespawnLocation = basecampSpawn
	else
		warn("Mount Rill: BasecampSpawn was not found in Workspace")
	end

	player.CharacterAdded:Connect(function(character)
		task.defer(placeCharacterAtCheckpoint, player, character)
	end)
end

Players.PlayerAdded:Connect(initializePlayer)

for _, player in Players:GetPlayers() do
	task.spawn(initializePlayer, player)
end