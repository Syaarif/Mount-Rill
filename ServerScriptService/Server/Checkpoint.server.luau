local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local CheckpointService = require(script.Parent.CheckpointService)

local checkpointFolder = workspace:FindFirstChild(Config.CheckpointSystem.FolderName)
if not checkpointFolder then
	warn("Mount Rill: Checkpoint folder was not found: " .. Config.CheckpointSystem.FolderName)
	return
end

for _, descendant in checkpointFolder:GetDescendants() do
	if descendant:IsA("BasePart") then
		CheckpointService:BindCheckpoint(descendant)
	end
end

checkpointFolder.DescendantAdded:Connect(function(descendant)
	if descendant:IsA("BasePart") then
		CheckpointService:BindCheckpoint(descendant)
	end
end)
