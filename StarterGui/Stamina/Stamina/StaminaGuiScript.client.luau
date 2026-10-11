local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local player = Players.LocalPlayer
local shared = ReplicatedStorage:WaitForChild("Shared")
local Config = require(shared:WaitForChild("Config"))
local maxStamina = Config.Stamina.MaxStamina

local container = script.Parent
local fillBar = container:WaitForChild("blank")
local label = fillBar:WaitForChild("label")

local function updateStaminaUi()
	local stamina = player:GetAttribute("Stamina")
	if typeof(stamina) ~= "number" then
		stamina = 0
	end

	local progress = math.clamp(stamina / maxStamina, 0, 1)
	local currentSize = fillBar.Size
	fillBar.Size = UDim2.new(progress, 0, currentSize.Y.Scale, currentSize.Y.Offset)
	label.Text = string.format("%d / %d", math.floor(stamina + 0.5), maxStamina)
end

updateStaminaUi()
player:GetAttributeChangedSignal("Stamina"):Connect(updateStaminaUi)
