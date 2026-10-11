local Players = game:GetService("Players")

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Config = require(ReplicatedStorage.Shared.Config)
local EnvironmentalConditionService = require(script.Parent.EnvironmentalConditionService)

local staminaConfig = Config.Stamina
local hydrationConfig = Config.Hydration
local lastSprintAt: { [Player]: number } = {}

local function logSprint(message: string)
	if staminaConfig.DebugSprint then
		print("[Mount Rill][Stamina] " .. message)
	end
end

local function clampStamina(value: number): number
	return math.clamp(value, 0, staminaConfig.MaxStamina)
end

local function getHumanoid(player: Player): Humanoid?
	local character = player.Character
	if not character then
		return nil
	end

	return character:FindFirstChildOfClass("Humanoid")
end

local function getSpeedMultiplier(stamina: number): number
	if stamina >= staminaConfig.SpeedPenaltyThreshold then
		return 1
	end

	local staminaRatio = math.clamp(stamina / staminaConfig.SpeedPenaltyThreshold, 0, 1)
	return staminaConfig.MinimumSpeedMultiplier + (1 - staminaConfig.MinimumSpeedMultiplier) * staminaRatio
end

local function updateWalkSpeed(humanoid: Humanoid, stamina: number, isSprinting: boolean)
	local baseWalkSpeed = humanoid:GetAttribute("MountRillBaseWalkSpeed")
	if typeof(baseWalkSpeed) ~= "number" then
		baseWalkSpeed = humanoid.WalkSpeed
		if baseWalkSpeed <= 0 then
			baseWalkSpeed = staminaConfig.BaseWalkSpeed
		end
		humanoid:SetAttribute("MountRillBaseWalkSpeed", baseWalkSpeed)
	end

	local speed = baseWalkSpeed * getSpeedMultiplier(stamina)
	if isSprinting then
		speed *= staminaConfig.SprintSpeedMultiplier
	end
	humanoid.WalkSpeed = speed
end

local function updateStamina(player: Player, deltaTime: number)
	if player:GetAttribute("MountRillInitialized") ~= true then
		return
	end

	local currentStamina = player:GetAttribute("Stamina")
	if typeof(currentStamina) ~= "number" then
		currentStamina = staminaConfig.StartingStamina
	end

	local humanoid = getHumanoid(player)
	if not humanoid or humanoid.Health <= 0 then
		player:SetAttribute("MovementState", "Idle")
		player:SetAttribute("Sprinting", false)
		return
	end

	local isMoving = humanoid.MoveDirection.Magnitude > 0
	local wantsToSprint = player:GetAttribute("SprintRequested") == true
	local wasSprinting = player:GetAttribute("Sprinting") == true
	local canResumeSprint = currentStamina >= staminaConfig.SprintResumeThreshold
	local isSprinting = wantsToSprint and isMoving and currentStamina > 0 and (wasSprinting or canResumeSprint)
	local previousState = player:GetAttribute("MovementState")

	if isSprinting then
		lastSprintAt[player] = os.clock()
		currentStamina = clampStamina(currentStamina - staminaConfig.SprintDrainRate * deltaTime * EnvironmentalConditionService:GetStaminaDrainMultiplier(player))
		if currentStamina <= 0 then
			isSprinting = false
			player:SetAttribute("SprintRequested", false)
		end
	elseif os.clock() - (lastSprintAt[player] or 0) >= staminaConfig.RegenDelay then
		local regenMultiplier = 1
		local hydration = player:GetAttribute("Hydration")
		if typeof(hydration) == "number" and hydration < hydrationConfig.LowHydrationThreshold then
			regenMultiplier = hydrationConfig.LowHydrationStaminaRegenMultiplier
		end
		currentStamina = clampStamina(currentStamina + staminaConfig.RecoveryRate * regenMultiplier * deltaTime)
	end

	local movementState = if isSprinting then "Sprinting" elseif isMoving then "Walking" else "Idle"
	player:SetAttribute("MovementState", movementState)
	player:SetAttribute("Sprinting", isSprinting)
	player:SetAttribute("Stamina", currentStamina)
	updateWalkSpeed(humanoid, currentStamina, isSprinting)
	if previousState ~= movementState then
		logSprint(player.Name .. " MovementState: " .. tostring(previousState) .. " -> " .. movementState .. ", MoveDirection=" .. tostring(humanoid.MoveDirection.Magnitude) .. ", SprintRequested=" .. tostring(wantsToSprint))
	end
end

local function bindCharacter(player: Player, character: Model)
	local humanoid = character:WaitForChild("Humanoid", 5)
	if not humanoid or not humanoid:IsA("Humanoid") then
		return
	end

	humanoid:SetAttribute("MountRillBaseWalkSpeed", humanoid.WalkSpeed)
	humanoid.StateChanged:Connect(function(_, newState)
		if newState ~= Enum.HumanoidStateType.Jumping or player:GetAttribute("MountRillInitialized") ~= true then
			return
		end

		local stamina = player:GetAttribute("Stamina")
		if typeof(stamina) == "number" then
			player:SetAttribute("Stamina", clampStamina(stamina - staminaConfig.JumpCost))
		end
	end)
end

local function trackPlayer(player: Player)
	lastSprintAt[player] = 0
	player.CharacterAdded:Connect(function(character)
		bindCharacter(player, character)
	end)
	if player.Character then
		bindCharacter(player, player.Character)
	end

	task.spawn(function()
		local lastUpdate = os.clock()
		while player.Parent do
			task.wait(staminaConfig.UpdateInterval)
			local now = os.clock()
			local deltaTime = now - lastUpdate
			lastUpdate = now
			updateStamina(player, deltaTime)
		end
	end)
end

Players.PlayerAdded:Connect(trackPlayer)
Players.PlayerRemoving:Connect(function(player)
	lastSprintAt[player] = nil
end)

for _, player in Players:GetPlayers() do
	task.spawn(trackPlayer, player)
end