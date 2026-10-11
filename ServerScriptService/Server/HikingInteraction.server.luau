local Players = game:GetService("Players")
local Config = require(game:GetService("ReplicatedStorage").Shared.Config)

local function updateHikingState(player: Player)
	if player:GetAttribute("MountRillInitialized") ~= true then
		return
	end

	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	local isHiking = humanoid ~= nil
		and humanoid.Health > 0
		and humanoid.MoveDirection.Magnitude > 0
	player:SetAttribute("Hiking", isHiking)
end

task.spawn(function()
	while true do
		task.wait(Config.EnvironmentalCondition.ConditionUpdateInterval)
		for _, player in Players:GetPlayers() do
			updateHikingState(player)
		end
	end
end)
