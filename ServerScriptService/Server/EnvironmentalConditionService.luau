local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)

local EnvironmentalConditionService = {}
local obstacleExpiryByPlayer: { [Player]: number } = {}

local function getWeatherState()
	local stateName = workspace:GetAttribute("MountRillWeather")
	if typeof(stateName) ~= "string" then
		stateName = Config.Weather.StartingState
	end

	return Config.Weather.States[stateName] or Config.Weather.States[Config.Weather.StartingState]
end

local function clearExpiredObstacle(player: Player)
	local expiry = obstacleExpiryByPlayer[player]
	if expiry and os.clock() >= expiry then
		obstacleExpiryByPlayer[player] = nil
		player:SetAttribute("TerrainCondition", Config.EnvironmentalCondition.DefaultTerrain)
	end
end

function EnvironmentalConditionService:InitializePlayer(player: Player)
	player:SetAttribute("Temperature", Config.EnvironmentalCondition.DefaultTemperature)
	player:SetAttribute("TerrainCondition", Config.EnvironmentalCondition.DefaultTerrain)
	player:SetAttribute("EnvironmentalCondition", "Normal")
	player:SetAttribute("Hiking", false)
end

function EnvironmentalConditionService:SetObstacleCondition(player: Player, conditionName: string)
	obstacleExpiryByPlayer[player] = os.clock() + Config.Interaction.ObstacleDuration
	player:SetAttribute("TerrainCondition", conditionName)
	player:SetAttribute("EnvironmentalCondition", "DifficultTerrain")
end

function EnvironmentalConditionService:UpdatePlayer(player: Player)
	if player:GetAttribute("MountRillInitialized") ~= true then
		return
	end

	clearExpiredObstacle(player)
	local weather = getWeatherState()
	local isOnObstacle = obstacleExpiryByPlayer[player] ~= nil
	player:SetAttribute("EnvironmentalCondition", if isOnObstacle then "DifficultTerrain" else "Normal")
	player:SetAttribute("StaminaDrainMultiplier", (weather.StaminaDrainMultiplier or 1) * (if isOnObstacle then 1.25 else 1))
	player:SetAttribute("HydrationDrainMultiplier", weather.HydrationDrainMultiplier or 1)
	player:SetAttribute("EnergyDrainMultiplier", weather.EnergyDrainMultiplier or 1)
end

function EnvironmentalConditionService:GetStaminaDrainMultiplier(player: Player): number
	local multiplier = player:GetAttribute("StaminaDrainMultiplier")
	return if typeof(multiplier) == "number" then multiplier else Config.EnvironmentalCondition.DefaultStaminaDrainMultiplier
end

function EnvironmentalConditionService:GetHydrationDrainMultiplier(player: Player): number
	local multiplier = player:GetAttribute("HydrationDrainMultiplier")
	return if typeof(multiplier) == "number" then multiplier else Config.EnvironmentalCondition.DefaultHydrationDrainMultiplier
end

return EnvironmentalConditionService
