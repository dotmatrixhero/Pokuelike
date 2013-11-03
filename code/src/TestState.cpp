#include "../include/TestState.hpp"

TestState::TestState(StateStack& stateStack)
    : State(stateStack)
{
    thingx = 10;
    thingy = 10;
}

TestState::~TestState()
{
}

bool TestState::draw()
{
    TCODConsole::root->print(11, 10, "ELLO WORLD! FINALLY!");
    TCODConsole::root->print(thingx, thingy, "H");
    return false;
}

bool TestState::update()
{
    return false;
}

bool TestState::handleInput(TCOD_key_t key)
{
    if (key.vk == TCODK_UP)
        thingy -= 1;
    else if (key.vk == TCODK_DOWN)
        thingy += 1;
    else if (key.vk == TCODK_LEFT)
        thingx -= 1;
    else if (key.vk == TCODK_RIGHT)
        thingx += 1;
    return false;
}
