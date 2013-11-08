#include "../include/DebugState.hpp"

DebugState::DebugState(StateStack& stateStack)
    : State(stateStack)
{
}

DebugState::~DebugState()
{
}

void DebugState::draw()
{
    TCODConsole::root->print(30, 30, "DEBUG MODE ACTIVATED");
}

bool DebugState::update()
{
    return false;
}

bool DebugState::handleInput(TCOD_key_t key)
{
    if (key.vk == TCODK_BACKSPACE)
        requestStackPop();
    return false;
}
