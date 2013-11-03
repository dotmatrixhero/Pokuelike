#include "../include/TestState.hpp"

#include <libtcod.hpp>

TestState::TestState(StateStack& stateStack)
    : State(stateStack)
{
}

TestState::~TestState()
{
}

bool TestState::draw()
{
    TCODConsole::root->print(10, 10, "HELLO WORLD! FINALLY!");
    return false;
}

bool TestState::update()
{
    return false;
}

bool TestState::handleInput()
{
    return false;
}
