local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)

local CheckpointService = {}
local checkpointByName = {}
local checkpointByPartName = {}

for index, checkpoint in ipairs(Config.CheckpointSystem.Checkpoints) do
	checkpointByName[checkpoint.Name] = {
		Config = checkpoint,
		Index = index,
	}
	checkpointByPartName[checkpoint.PartName] = {
		Config = checkpoint,
		Index = index,
	}
end

local function getPlayerFromHit(hit: BasePart): Player?
	local character = hit:FindFirstAncestorOfClass("Model")
	if not character then
		return nil
	end

	return Players:GetPlayerFromCharacter(character)
end

local function setRespawnLocation(player: Player, checkpoint)
	local spawnName = checkpoint.SpawnName
	if not spawnName then
		return
	end

	local spawn = workspace:FindFirstChild(spawnName, true)
	if spawn and spawn:IsA("SpawnLocation") then
		player.RespawnLocation = spawn
	end
end

function CheckpointService:TryAdvance(player: Player, checkpointPartName: string): boolean
	local target = checkpointByPartName[checkpointPartName]
	if not target or player:GetAttribute("MountRillInitialized") ~= true then
		return false
	end

	local currentName = player:GetAttribute("Checkpoint")
	local current = checkpointByName[currentName]
	if not current or target.Index ~= current.Index + 1 then
		return false
	end

	player:SetAttribute("Checkpoint", target.Config.Name)
	setRespawnLocation(player, target.Config)
	return true
end

function CheckpointService:BindCheckpoint(part: BasePart)
	local target = checkpointByPartName[part.Name]
	if not target then
		return
	end

	part.Touched:Connect(function(hit)
		local player = getPlayerFromHit(hit)
		if player then
			self:TryAdvance(player, part.Name)
		end
	end)
end

function CheckpointService:GetCheckpointCount(): number
	return #Config.CheckpointSystem.Checkpoints
end

return CheckpointService
