local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local EnvironmentalConditionService = require(script.Parent.EnvironmentalConditionService)

local function initializePlayer(player: Player)
	EnvironmentalConditionService:InitializePlayer(player)
end

Players.PlayerAdded:Connect(initializePlayer)
Players.PlayerRemoving:Connect(function(player)
	EnvironmentalConditionService:UpdatePlayer(player)
end)

for _, player in Players:GetPlayers() do
	initializePlayer(player)
end

task.spawn(function()
	while true do
		task.wait(Config.EnvironmentalCondition.ConditionUpdateInterval)
		for _, player in Players:GetPlayers() do
			EnvironmentalConditionService:UpdatePlayer(player)
		end
	end
end)
