local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local EnvironmentalConditionService = require(script.Parent.EnvironmentalConditionService)

local hydrationConfig = Config.Hydration

local function clampHydration(value: number): number
	return math.clamp(value, 0, hydrationConfig.MaxHydration)
end

local function updateHydration(player: Player, deltaTime: number)
	if player:GetAttribute("MountRillInitialized") ~= true then
		return
	end

	local movementState = player:GetAttribute("MovementState")
	local drainRate = if movementState == "Sprinting"
		then hydrationConfig.SprintingDrainRate
		elseif movementState == "Walking"
		then hydrationConfig.WalkingDrainRate
		else 0
	if drainRate <= 0 then
		return
	end

	local currentHydration = player:GetAttribute("Hydration")
	if typeof(currentHydration) ~= "number" then
		currentHydration = hydrationConfig.MaxHydration
	end

	local nextHydration = clampHydration(currentHydration - drainRate * deltaTime * EnvironmentalConditionService:GetHydrationDrainMultiplier(player))
	if nextHydration ~= currentHydration then
		player:SetAttribute("Hydration", nextHydration)
	end
end

Players.PlayerAdded:Connect(function(player)
	task.spawn(function()
		local lastUpdate = os.clock()
		while player.Parent do
			task.wait(hydrationConfig.UpdateInterval)
			local now = os.clock()
			local deltaTime = now - lastUpdate
			lastUpdate = now
			updateHydration(player, deltaTime)
		end
	end)
end)

for _, player in Players:GetPlayers() do
	task.spawn(function()
		local lastUpdate = os.clock()
		while player.Parent do
			task.wait(hydrationConfig.UpdateInterval)
			local now = os.clock()
			local deltaTime = now - lastUpdate
			lastUpdate = now
			updateHydration(player, deltaTime)
		end
	end)
end
