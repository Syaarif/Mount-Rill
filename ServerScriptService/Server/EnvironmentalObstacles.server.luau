local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local EnvironmentalConditionService = require(script.Parent.EnvironmentalConditionService)

local function getPlayerFromHit(hit: BasePart): Player?
	local character = hit:FindFirstAncestorOfClass("Model")
	return if character then Players:GetPlayerFromCharacter(character) else nil
end

local function bindObstacle(instance: Instance)
	if not instance:IsA("BasePart") then
		return
	end

	instance.Touched:Connect(function(hit)
		local player = getPlayerFromHit(hit)
		if not player or player:GetAttribute("MountRillInitialized") ~= true then
			return
		end

		local conditionName = instance:GetAttribute("TerrainCondition")
		if typeof(conditionName) ~= "string" then
			conditionName = "DifficultTerrain"
		end
		EnvironmentalConditionService:SetObstacleCondition(player, conditionName)
	end)
end

for _, instance in CollectionService:GetTagged(Config.Interaction.ObstacleTag) do
	bindObstacle(instance)
end
CollectionService:GetInstanceAddedSignal(Config.Interaction.ObstacleTag):Connect(bindObstacle)
