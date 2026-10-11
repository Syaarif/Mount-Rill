local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local lastRefillAt: { [Player]: number } = {}

local function getPlayerFromHit(hit: BasePart): Player?
	local character = hit:FindFirstAncestorOfClass("Model")
	return if character then Players:GetPlayerFromCharacter(character) else nil
end

local function refill(player: Player)
	if player:GetAttribute("MountRillInitialized") ~= true then
		return
	end

	local now = os.clock()
	if now - (lastRefillAt[player] or 0) < Config.Hydration.RefillCooldown then
		return
	end

	local current = player:GetAttribute("Hydration")
	if typeof(current) ~= "number" then
		return
	end

	lastRefillAt[player] = now
	player:SetAttribute("Hydration", math.clamp(current + Config.Hydration.RefillAmount, 0, Config.Hydration.MaxHydration))
end

local function bindWaterRefill(instance: Instance)
	if not instance:IsA("BasePart") then
		return
	end

	instance.Touched:Connect(function(hit)
		local player = getPlayerFromHit(hit)
		if player then
			refill(player)
		end
	end)
end

for _, instance in CollectionService:GetTagged(Config.Interaction.WaterRefillTag) do
	bindWaterRefill(instance)
end
CollectionService:GetInstanceAddedSignal(Config.Interaction.WaterRefillTag):Connect(bindWaterRefill)
Players.PlayerRemoving:Connect(function(player)
	lastRefillAt[player] = nil
end)
