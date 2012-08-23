/*
 * File:   Drawable.cpp
 * Author: Brian
 *
 * Created on June 16, 2012, 9:29 PM
 */


#include "Drawable.h"
using namespace std;




Drawable::Drawable(int X, int Y, int C, TCODColor FORE, TCODColor BACK, bool TRANS, bool WALK, string TYPE)
        : x(X),
        y(Y),
        c(C),
        fore(FORE),
        back(BACK),
        trans(TRANS),
        walk(WALK),
        key(TYPE)
{

//    std::cout<<"hey there delilah"<<std::endl;
}

Drawable::Drawable(int C, TCODColor FORE, TCODColor BACK, bool TRANS, bool WALK)
        :
        x(0), // temp
        y(8), // temp
        c(C),
        fore(FORE),
        back(BACK),
        trans(TRANS),
        walk(WALK)
{
}

Drawable::Drawable(int X, int Y, int C)
        :x(X),
        y(Y),
        c(C),
        fore(TCODColor::white),
        back(TCODColor::black),
        trans(false),
        walk(false)
{
}

Drawable::~Drawable()
{
}

void Drawable::setKey(std::string name){
    (this->key).replace(0,4, name);
}

void Drawable::setX(int x)
{
    this->x = x;
}

void Drawable::setY(int y)
{
    this->y = y;
}

bool Drawable::moveRight()
{
    //implement using gameplay.mapPosx, etc. to define these values
    if (x < mapw-1)
    {
        x++;
        return true;
    }
    return false;
}

bool Drawable::moveDown()
{
    if (y < maph-1)
    {
        y++;
        return true;
    }
    return false;
}

bool Drawable::moveLeft()
{
    if (x > 0)
    {
        x--;
        return true;
    }
    return false;
}

bool Drawable::moveUp()
{
    if (y > 0)
    {
        y--;
        return true;
    }
    return false;
}

bool Drawable::moveUpLeft()
{
    if (x > 0 && y > 0)
    {
        x--;
        y--;
        return true;
    }
    return false;
}

bool Drawable::moveDownLeft()
{
    if (x > 0 && y < maph-1)
    {
        x--;
        y++;
        return true;
    }
    return false;
}

bool Drawable::moveUpRight()
{
    if (x < mapw-1 && y > 0)
    { //implement using gameplay.mapPosx, etc. to define these values
        x++;
        y--;
        return true;
    }
    return false;
}

bool Drawable::moveDownRight()
{
    if (x < mapw-1 && y < maph-1){ //implement using gameplay.mapPosx, etc. to define these values
        x++;
        y++;
        return true;
    }
    return false;
}

void Drawable::draw(TCODConsole* ConsoleMap)
{

    ConsoleMap->putCharEx(x, y, c, fore, back);
   // ConsoleMap->setCharForeground(x,y, TCODColor::white);
}

void Drawable::drawWashed(TCODConsole* ConsoleMap){
    ConsoleMap->putCharEx(x, y, c, fore*TCODColor::darkGrey, back*TCODColor::darkGrey);
}
int Drawable::returnx(){
   return x;
}

int Drawable::returny(){
   return y;
}

int Drawable::returnz(){
   return c;
}
std::string Drawable::returnkey(){
    return key;
}

TCODColor Drawable::returnfore(){
   return fore;
}

TCODColor Drawable::returnback(){
   return back;
}

bool Drawable::returntrans(){
    return trans;
}

bool Drawable::returnwalk(){
    return walk;
}


