#include "../include/TestState.hpp"
#include "../include/StateIdentifiers.hpp"

TestState::TestState(StateStack& stateStack)
    : State(stateStack)
{
}

TestState::~TestState()
{
}

void TestState::draw()
{
    TCODConsole::root->print(11, 10, "HELLO LIBTCOD WORLD!");
}

bool TestState::update()
{
    return false;
}

bool TestState::handleInput(TCOD_key_t key)
{
    if (key.c == 'a')
        requestStackPush(States::Debug);

    return false;
}
