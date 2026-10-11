local CollectionService = game:GetService("CollectionService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage.Shared.Config)
local staminaConfig = Config.Stamina
local energyConfig = Config.Energy

local function getRoot(player: Player): BasePart?
	local character = player.Character
	if not character then
		return nil
	end

	return character:FindFirstChild("HumanoidRootPart") :: BasePart?
end

local function isRestingAtArea(player: Player, area: BasePart): boolean
	local root = getRoot(player)
	local humanoid = player.Character and player.Character:FindFirstChildOfClass("Humanoid")
	return root ~= nil
		and humanoid ~= nil
		and humanoid.Health > 0
		and humanoid.MoveDirection.Magnitude == 0
		and (root.Position - area.Position).Magnitude <= Config.Interaction.RestDistance
end

local function updatePlayer(player: Player, deltaTime: number, areas: { Instance })
	if player:GetAttribute("MountRillInitialized") ~= true then
		return
	end

	local resting = false
	for _, area in areas do
		if area:IsA("BasePart") and isRestingAtArea(player, area) then
			resting = true
			break
		end
	end

	player:SetAttribute("Resting", resting)
	if not resting then
		return
	end

	local stamina = player:GetAttribute("Stamina")
	if typeof(stamina) == "number" then
		player:SetAttribute("Stamina", math.clamp(stamina + staminaConfig.RecoveryRate * deltaTime, 0, staminaConfig.MaxStamina))
	end

	local energy = player:GetAttribute("Energy")
	if typeof(energy) == "number" then
		player:SetAttribute("Energy", math.clamp(energy + energyConfig.RestRecoveryRate * deltaTime, 0, energyConfig.MaxEnergy))
	end
end

task.spawn(function()
	local lastUpdate = os.clock()
	while true do
		task.wait(energyConfig.RestUpdateInterval)
		local now = os.clock()
		local deltaTime = now - lastUpdate
		lastUpdate = now
		local areas = CollectionService:GetTagged(Config.Interaction.RestAreaTag)
		for _, player in Players:GetPlayers() do
			updatePlayer(player, deltaTime, areas)
		end
	end
end)
