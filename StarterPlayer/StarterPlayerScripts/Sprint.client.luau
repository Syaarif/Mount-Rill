local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local sprintRemote = ReplicatedStorage:WaitForChild("MountRillRemotes"):WaitForChild("SprintRequest")

local function logSprint(message: string)
	if Config.Stamina.DebugSprint then
		print("[Mount Rill][Sprint Client] " .. message)
	end
end

local function sendSprintRequest(isRequested: boolean)
	sprintRemote:FireServer(isRequested)
	logSprint("SprintRequest fired: " .. tostring(isRequested))
end

UserInputService.InputBegan:Connect(function(input, gameProcessedEvent)
	if not gameProcessedEvent and input.KeyCode == Enum.KeyCode.LeftShift then
		sendSprintRequest(true)
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.KeyCode == Enum.KeyCode.LeftShift then
		sendSprintRequest(false)
	end
end)
